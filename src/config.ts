import { Config } from "effect";

// Discovery timeout in milliseconds. Defaults to 5000.
export const DiscoveryTimeoutConfig = Config.number("CAST_DISCOVERY_TIMEOUT_MS").pipe(
  Config.withDefault(5000),
);

// REST API server port config. Defaults to 3334 if enabled.
export const RestPortConfig = Config.number("REST_PORT").pipe(Config.withDefault(3334));
