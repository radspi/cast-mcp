import { Deferred, Effect, Layer, Ref } from "effect";
import MulticastDNS from "multicast-dns";
import { CastClient } from "../domain/CastClient.ts";
import { CastConnectionError, CastMediaError } from "../domain/errors.ts";
import {
  AppInfo,
  CastDevice,
  MediaStatus,
  type QueueItem,
  ReceiverStatus,
} from "../domain/models.ts";

// castv2-client has no TypeScript types — import as plain JS modules.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client, DefaultMediaReceiver } = require("castv2-client") as {
  // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
  Client: new () => any;
  // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
  DefaultMediaReceiver: any;
};

// Resolve device type from castv2 capability bitmask.
// ca & 2048 = audio group, ca & 4 = video capable, else audio-only.
const resolveDeviceType = (ca: number): "audio" | "video" | "group" => {
  if (ca & 2048) return "group";
  if (ca & 4) return "video";
  return "audio";
};

// Parse TXT record buffer array into a key-value map.
const parseTxt = (txt: Buffer[]): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const buf of txt) {
    const str = buf.toString("utf8");
    const eq = str.indexOf("=");
    if (eq !== -1) {
      result[str.slice(0, eq)] = str.slice(eq + 1);
    }
  }
  return result;
};

// Wrap a castv2-client callback-style function in a Promise.
// The callback is expected to follow the (err, result) => void convention.
const promisify = <T>(fn: (cb: (err: Error | null, result: T) => void) => void): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    fn((err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

// Void variant: callback is (err: Error | null) => void with no result.
const promisifyVoid = (fn: (cb: (err: Error | null) => void) => void): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    fn((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

// castv2-client does not time out callbacks when a receiver has already
// closed its transport channel. Keep HTTP callers from waiting forever.
const withTimeout = <T>(promise: Promise<T>, operation: string, timeoutMs = 15_000): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${operation} timed out`)), timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

// Connect a PlatformSender (castv2-client Client) to a Cast device.
const connectPlatform = (
  host: string,
  port = 8009,
  // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
): Effect.Effect<any, CastConnectionError> =>
  Effect.tryPromise({
    try: () =>
      // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
      new Promise<any>((resolve, reject) => {
        const client = new Client();
        client.connect({ host, port }, () => resolve(client));
        client.on("error", (err: unknown) => reject(err));
      }),
    catch: (e) => new CastConnectionError({ host, cause: e }),
  });

// Launch DefaultMediaReceiver on an already-connected PlatformSender.
const launchReceiver = (
  // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
  client: any,
  host: string,
  // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
): Effect.Effect<any, CastConnectionError> =>
  Effect.tryPromise({
    try: () =>
      withTimeout(
        // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
        promisify<any>((cb) => client.launch(DefaultMediaReceiver, cb)),
        `launch DefaultMediaReceiver on ${host}`,
      ),
    catch: (e) => new CastConnectionError({ host, cause: e }),
  });

// biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
const mediaStatusFrom = (status: any): MediaStatus =>
  new MediaStatus({
    playerState: status?.playerState ?? "IDLE",
    currentTime: status?.currentTime ?? 0,
    duration: status?.media?.duration,
    title: status?.media?.metadata?.title,
    artist: status?.media?.metadata?.artist,
    albumName: status?.media?.metadata?.albumName,
  });

// biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
type CastConn = { client: any; player?: any };

// biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
const isPlayerAlive = (player: any): boolean => player?.connection != null && player?.media != null;

export const CastClientLive = Layer.scoped(
  CastClient,
  Effect.gen(function* () {
    // Connection pool: host → platform connection, with a media player created on demand.
    // Receiver-only operations such as getStatus must not launch DefaultMediaReceiver:
    // doing so visibly switches the TV to the blue Cast screen.
    const poolRef = yield* Ref.make<Map<string, CastConn>>(new Map());

    // Serialize per-host Cast operations so overlapping REST calls do not race on connect/launch.
    const hostTurnRef = yield* Ref.make<Map<string, Deferred.Deferred<void, never>>>(new Map());

    // Deduplicate in-flight platform connects and receiver launches for the same host.
    const connInFlightRef = yield* Ref.make<
      Map<string, Deferred.Deferred<CastConn, CastConnectionError>>
    >(new Map());
    const playerInFlightRef = yield* Ref.make<
      Map<string, Deferred.Deferred<void, CastConnectionError>>
    >(new Map());

    const withHostSerial = <A, E, R>(host: string, effect: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const myTurn = yield* Deferred.make<void, never>();
        const prevTurn = yield* Ref.modify(hostTurnRef, (turns) => {
          const prev = turns.get(host);
          const next = new Map(turns);
          next.set(host, myTurn);
          return [prev, next] as const;
        });

        if (prevTurn) {
          yield* Deferred.await(prevTurn);
        }

        return yield* effect.pipe(Effect.ensuring(Deferred.succeed(myTurn, void 0)));
      });

    // Do not let an event from an old socket evict a newer replacement connection.
    // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
    const evict = (host: string, client?: any) =>
      Ref.update(poolRef, (m) => {
        if (client && m.get(host)?.client !== client) return m;
        const next = new Map(m);
        next.delete(host);
        return next;
      });

    const registerConn = (host: string, client: CastConn["client"]) =>
      Effect.gen(function* () {
        const conn: CastConn = { client };
        yield* Ref.update(poolRef, (m) => new Map(m).set(host, conn));

        // Evict dead connections so the next call reconnects automatically.
        client.on("error", () => Effect.runFork(evict(host, client)));
        client.on("close", () => Effect.runFork(evict(host, client)));

        return conn;
      });

    const connectAndRegister = (host: string, port = 8009) =>
      Effect.gen(function* () {
        const client = yield* connectPlatform(host, port);
        return yield* registerConn(host, client);
      });

    const getConn = (host: string, port = 8009) =>
      Effect.gen(function* () {
        const pool = yield* Ref.get(poolRef);
        const existing = pool.get(host);
        if (existing) return existing;

        const inFlight = yield* Ref.get(connInFlightRef);
        const pending = inFlight.get(host);
        if (pending) return yield* Deferred.await(pending);

        const gate = yield* Deferred.make<CastConn, CastConnectionError>();
        yield* Ref.update(connInFlightRef, (m) => new Map(m).set(host, gate));

        return yield* connectAndRegister(host, port).pipe(
          Effect.tap((conn) => Deferred.succeed(gate, conn)),
          Effect.tapError((e) => Deferred.fail(gate, e)),
          Effect.ensuring(
            Ref.update(connInFlightRef, (m) => {
              const next = new Map(m);
              next.delete(host);
              return next;
            }),
          ),
        );
      });

    const attachPlayer = (conn: CastConn, player: CastConn["player"]) => {
      conn.player = player;
      player.once("close", () => {
        if (conn.player === player) conn.player = undefined;
      });
      return player;
    };

    const launchAndAttach = (conn: CastConn, host: string) =>
      Effect.gen(function* () {
        const player = yield* launchReceiver(conn.client, host);
        return attachPlayer(conn, player);
      });

    const getPlayer = (host: string) =>
      Effect.gen(function* () {
        const conn = yield* getConn(host);
        if (conn.player && isPlayerAlive(conn.player)) return conn;
        if (conn.player) conn.player = undefined;

        const inFlight = yield* Ref.get(playerInFlightRef);
        const pending = inFlight.get(host);
        if (pending) {
          yield* Deferred.await(pending);
          return conn;
        }

        const gate = yield* Deferred.make<void, CastConnectionError>();
        yield* Ref.update(playerInFlightRef, (m) => new Map(m).set(host, gate));

        yield* launchAndAttach(conn, host).pipe(
          Effect.tap(() => Deferred.succeed(gate, void 0)),
          Effect.tapError((e) => Deferred.fail(gate, e)),
          Effect.ensuring(
            Ref.update(playerInFlightRef, (m) => {
              const next = new Map(m);
              next.delete(host);
              return next;
            }),
          ),
        );

        return conn;
      });

    // Close all open connections on scope exit.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const pool = yield* Ref.get(poolRef);
        for (const { client } of pool.values()) {
          try {
            client.close();
          } catch {
            // ignore close errors during teardown
          }
        }
      }),
    );

    // Shared implementation for queueNext (+1) and queuePrev (-1).
    const queueMove = (host: string, delta: 1 | -1) =>
      Effect.gen(function* () {
        const conn = yield* getPlayer(host);
        yield* Effect.tryPromise({
          try: () =>
            new Promise<void>((resolve, reject) => {
              // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
              const currentSession = conn.player.media?.currentSession as any;
              const currentId: number | undefined = currentSession?.currentItemId;
              const items: Array<{ itemId: number }> = currentSession?.items ?? [];
              const idx = items.findIndex((i) => i.itemId === currentId);
              const target = items[idx + delta];
              if (!target) {
                resolve();
                return;
              }
              conn.player.media.request(
                { type: "QUEUE_UPDATE", currentItemId: target.itemId },
                (err: Error | null) => {
                  if (err) reject(err);
                  else resolve();
                },
              );
            }),
          catch: (e) =>
            new CastMediaError({
              message: `queue${delta > 0 ? "Next" : "Prev"} on ${host} failed`,
              cause: e,
            }),
        });
      });

    // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
    const receiverStatus = (client: any, host: string) =>
      Effect.tryPromise({
        try: () =>
          new Promise<ReceiverStatus>((resolve, reject) => {
            client.getStatus(
              // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
              (err: Error | null, status: any) => {
                if (err) {
                  reject(err);
                  return;
                }
                resolve(
                  new ReceiverStatus({
                    volume: status?.volume?.level ?? 0.5,
                    muted: status?.volume?.muted ?? false,
                    applications: (status?.applications ?? []).map(
                      // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
                      (app: any) =>
                        new AppInfo({
                          appId: app.appId,
                          displayName: app.displayName,
                          sessionId: app.sessionId,
                        }),
                    ),
                  }),
                );
              },
            );
          }),
        catch: (e) => new CastConnectionError({ host, cause: e }),
      });

    const getStatus = (host: string) =>
      Effect.gen(function* () {
        const conn = yield* getConn(host);
        return yield* receiverStatus(conn.client, host).pipe(
          // A Cast receiver can close an idle socket without emitting close/error
          // before the next request. Drop that stale entry and retry once.
          Effect.catchAll(() =>
            Effect.gen(function* () {
              yield* evict(host, conn.client);
              try {
                conn.client.close();
              } catch {
                // The connection is already unusable; the fresh connection below is enough.
              }
              const fresh = yield* getConn(host);
              return yield* receiverStatus(fresh.client, host);
            }),
          ),
        );
      });

    const loadMedia = (
      // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
      player: any,
      host: string,
      contentUrl: string,
      contentType: string,
      metadata: object | undefined,
    ) =>
      Effect.tryPromise({
        try: () =>
          withTimeout(
            new Promise<MediaStatus>((resolve, reject) => {
              const media = {
                contentId: contentUrl,
                contentType,
                streamType: "BUFFERED",
                metadata: metadata ?? {},
              };
              player.load(
                media,
                { autoplay: true },
                // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
                (err: Error | null, status: any) => {
                  if (err) reject(err);
                  else resolve(mediaStatusFrom(status));
                },
              );
            }),
            `load media on ${host}`,
          ),
        catch: (e) =>
          new CastMediaError({
            message: `playMedia on ${host} failed`,
            cause: e,
          }),
      });

    return {
      discoverDevices: (timeoutMs = 5000) =>
        Effect.tryPromise({
          try: () =>
            new Promise<CastDevice[]>((resolve) => {
              const mdns = MulticastDNS();
              const devices = new Map<string, CastDevice>();
              const pending = new Map<
                string,
                { txt: Record<string, string>; host: string; port: number }
              >();

              const timer = setTimeout(() => {
                mdns.destroy();
                resolve([...devices.values()]);
              }, timeoutMs);

              // Unref so it doesn't block process exit
              if (typeof timer.unref === "function") timer.unref();

              mdns.on(
                "response",
                (response: {
                  answers: Array<{
                    type: string;
                    name: string;
                    data: unknown;
                  }>;
                  additionals: Array<{
                    type: string;
                    name: string;
                    data: unknown;
                  }>;
                }) => {
                  const all = [...response.answers, ...response.additionals];

                  // Map service instance name → device id so SRV records can
                  // be matched to the correct pending entry.
                  const serviceNameToId = new Map<string, string>();

                  for (const record of all) {
                    if (record.type === "TXT") {
                      const txt = parseTxt(record.data as Buffer[]);
                      const id = txt.id ?? record.name;
                      serviceNameToId.set(record.name, id);
                      if (!pending.has(id)) {
                        pending.set(id, { txt, host: "", port: 8009 });
                      }
                    }

                    if (record.type === "SRV") {
                      const srvData = record.data as {
                        target: string;
                        port: number;
                      };
                      // Match this SRV record to its corresponding pending
                      // entry by service name to avoid assigning the wrong
                      // host/port on networks with multiple Cast devices.
                      const id = serviceNameToId.get(record.name);
                      const entry = id !== undefined ? pending.get(id) : undefined;
                      if (entry && !entry.host) {
                        entry.host = srvData.target;
                        entry.port = srvData.port;
                      }
                    }
                  }

                  // Build devices from fully resolved pending entries
                  for (const [id, p] of pending.entries()) {
                    if (!p.host || devices.has(id)) continue;
                    const ca = Number.parseInt(p.txt.ca ?? "0", 10);
                    devices.set(
                      id,
                      new CastDevice({
                        id,
                        name: p.txt.fn ?? id,
                        host: p.host,
                        port: p.port,
                        type: resolveDeviceType(ca),
                        modelName: p.txt.md ?? "Unknown",
                        friendlyName: p.txt.fn ?? id,
                      }),
                    );
                  }
                },
              );

              mdns.query({
                questions: [{ name: "_googlecast._tcp.local", type: "PTR" }],
              });
            }),
          catch: (e) => new CastConnectionError({ host: "mdns", cause: e }),
        }),

      getStatus,

      playMedia: (host, contentUrl, contentType, metadata) =>
        withHostSerial(
          host,
          Effect.gen(function* () {
            const tryLoad = (conn: CastConn) =>
              Effect.gen(function* () {
                // Re-join the DefaultMediaReceiver session on every play request.
                // Reusing a cached player leaves load() waiting on a dead media channel.
                const player = yield* launchAndAttach(conn, host);
                return yield* loadMedia(player, host, contentUrl, contentType, metadata);
              });

            const conn = yield* getConn(host);
            return yield* tryLoad(conn).pipe(
              Effect.catchAll(() =>
                Effect.gen(function* () {
                  yield* evict(host, conn.client);
                  try {
                    conn.client.close();
                  } catch {
                    // Closing a stale client is best-effort.
                  }
                  conn.player = undefined;
                  const fresh = yield* getConn(host);
                  return yield* tryLoad(fresh);
                }),
              ),
            );
          }),
        ),

      pauseMedia: (host) =>
        Effect.gen(function* () {
          const conn = yield* getPlayer(host);
          yield* Effect.tryPromise({
            try: () => promisifyVoid((cb) => conn.player.pause(cb)),
            catch: (e) =>
              new CastMediaError({
                message: `pauseMedia on ${host} failed`,
                cause: e,
              }),
          });
        }),

      resumeMedia: (host) =>
        Effect.gen(function* () {
          const conn = yield* getPlayer(host);
          yield* Effect.tryPromise({
            try: () => promisifyVoid((cb) => conn.player.play(cb)),
            catch: (e) =>
              new CastMediaError({
                message: `resumeMedia on ${host} failed`,
                cause: e,
              }),
          });
        }),

      stopMedia: (host) =>
        Effect.gen(function* () {
          const conn = yield* getConn(host);

          // Pokud player neexistuje nebo není živej, nebudeme ho LAUNCHAT (to by spustilo novou appku!),
          // ale rovněž zastavíme aplikaci přes receiver client.
          if (!conn.player || !isPlayerAlive(conn.player)) {
            // Můžeme zavolat stopApp / receiver stop
            const status = yield* receiverStatus(conn.client, host).pipe(
              Effect.catchAll(() => Effect.succeed(null)),
            );
            const appId = status?.applications?.[0]?.sessionId;
            if (appId) {
              yield* Effect.tryPromise({
                try: () => promisifyVoid((cb) => conn.client.stop(appId, cb)),
                catch: (e) =>
                  new CastMediaError({ message: `stopMedia on ${host} failed`, cause: e }),
              }).pipe(Effect.catchAll(() => Effect.void));
            }
            return;
          }

          // Pokud spojení na player žije, pošleme stop normálně
          yield* Effect.tryPromise({
            try: () => promisifyVoid((cb) => conn.player.stop(cb)),
            catch: (e) =>
              new CastMediaError({
                message: `stopMedia on ${host} failed`,
                cause: e,
              }),
          });
        }),

      seekMedia: (host, currentTime) =>
        Effect.gen(function* () {
          const conn = yield* getPlayer(host);
          yield* Effect.tryPromise({
            try: () => promisifyVoid((cb) => conn.player.seek(currentTime, cb)),
            catch: (e) =>
              new CastMediaError({
                message: `seekMedia on ${host} failed`,
                cause: e,
              }),
          });
        }),

      getMediaStatus: (host) =>
        Effect.gen(function* () {
          const conn = yield* getPlayer(host);
          return yield* Effect.tryPromise({
            try: () =>
              new Promise<MediaStatus>((resolve, reject) => {
                conn.player.getStatus(
                  // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
                  (err: Error | null, status: any) => {
                    if (err) reject(err);
                    else resolve(mediaStatusFrom(status));
                  },
                );
              }),
            catch: (e) =>
              new CastMediaError({
                message: `getMediaStatus on ${host} failed`,
                cause: e,
              }),
          });
        }),

      getVolume: (host) =>
        Effect.gen(function* () {
          // Delegate to getStatus — it already fetches receiver status including volume.
          const status = yield* getStatus(host);
          return { level: status.volume, muted: status.muted };
        }),

      setVolume: (host, level) =>
        Effect.gen(function* () {
          const conn = yield* getConn(host);
          yield* Effect.tryPromise({
            try: () => promisifyVoid((cb) => conn.client.setVolume({ level }, cb)),
            catch: (e) => new CastConnectionError({ host, cause: e }),
          });
        }),

      setMuted: (host, muted) =>
        Effect.gen(function* () {
          const conn = yield* getConn(host);
          yield* Effect.tryPromise({
            try: () => promisifyVoid((cb) => conn.client.setVolume({ muted }, cb)),
            catch: (e) => new CastConnectionError({ host, cause: e }),
          });
        }),

      launchApp: (host, appId) =>
        Effect.gen(function* () {
          const conn = yield* getConn(host);
          return yield* Effect.tryPromise({
            try: () =>
              new Promise<AppInfo>((resolve, reject) => {
                // Launch an arbitrary app by appId via a synthetic Application class.
                // castv2-client has no type definitions — using any is unavoidable here.
                // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
                const AppClass: any = function (
                  // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
                  this: any,
                  // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
                  client: any,
                  // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
                  session: any,
                ) {
                  DefaultMediaReceiver.call(this, client, session);
                };
                AppClass.APP_ID = appId;
                Object.setPrototypeOf(
                  AppClass.prototype,
                  // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
                  (DefaultMediaReceiver as any).prototype,
                );

                conn.client.launch(
                  AppClass,
                  // biome-ignore lint/suspicious/noExplicitAny: castv2-client has no type definitions
                  (err: Error | null, app: any) => {
                    if (err) {
                      reject(err);
                      return;
                    }
                    const session = app?.session ?? {};
                    resolve(
                      new AppInfo({
                        appId: session.appId ?? appId,
                        displayName: session.displayName ?? appId,
                        sessionId: session.sessionId ?? "",
                      }),
                    );
                  },
                );
              }),
            catch: (e) => new CastConnectionError({ host, cause: e }),
          });
        }),

      stopApp: (host) =>
        Effect.gen(function* () {
          const conn = yield* getPlayer(host);
          yield* Effect.tryPromise({
            try: () => promisifyVoid((cb) => conn.client.stop(conn.player, cb)),
            catch: (e) => new CastConnectionError({ host, cause: e }),
          });
        }),

      loadQueue: (host, items: QueueItem[]) =>
        Effect.gen(function* () {
          const conn = yield* getPlayer(host);
          yield* Effect.tryPromise({
            try: () => {
              const queueItems = items.map((item) => ({
                media: {
                  contentId: item.media.contentId,
                  contentType: item.media.contentType,
                  streamType: "BUFFERED",
                  metadata: item.media.metadata ?? {},
                },
              }));
              return promisifyVoid((cb) =>
                conn.player.queueLoad(queueItems, { startIndex: 0, repeatMode: "REPEAT_OFF" }, cb),
              );
            },
            catch: (e) =>
              new CastMediaError({
                message: `loadQueue on ${host} failed`,
                cause: e,
              }),
          });
        }),

      // queueNext/queuePrev are implemented via queueUpdate with currentItemId jump.
      // The media controller's currentSession tracks the active item.
      queueNext: (host) => queueMove(host, 1),
      queuePrev: (host) => queueMove(host, -1),
    };
  }),
);
