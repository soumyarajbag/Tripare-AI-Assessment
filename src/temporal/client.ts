import { Client, Connection, type ClientOptions, type ConnectionOptions } from '@temporalio/client';
import { env } from '../config/env';

let _client: Client | null = null;

/**
 * Returns a singleton Temporal Client.
 * Lazily initialised on first call.
 */
export async function getTemporalClient(): Promise<Client> {
  if (_client) return _client;

  const connectionOptions: ConnectionOptions = {
    address: env.TEMPORAL_ADDRESS,
  };
  const connection = await Connection.connect(connectionOptions);

  const clientOptions: ClientOptions = {
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
  };
  _client = new Client(clientOptions);

  return _client;
}

/**
 * Cleanly close the Temporal client (used in graceful shutdown).
 */
export async function closeTemporalClient(): Promise<void> {
  if (_client) {
    await _client.connection.close();
    _client = null;
  }
}
