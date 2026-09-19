import { NativeConnection, Worker, type NativeConnectionOptions, type WorkerOptions } from '@temporalio/worker';
import * as activities from './activities/supplierActivities';
import { env } from '../config/env';
import { logger } from '../infrastructure/logger';

export async function runWorker(): Promise<void> {
  logger.info({ address: env.TEMPORAL_ADDRESS }, 'Temporal Worker: connecting');

  const connectionOptions: NativeConnectionOptions = {
    address: env.TEMPORAL_ADDRESS,
  };
  const connection = await NativeConnection.connect(connectionOptions);

  const workerOptions: WorkerOptions = {
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    // Point to the compiled workflow bundle
    workflowsPath: require.resolve('./workflows/hotelAggregator.workflow'),
    activities,
  };
  const worker = await Worker.create(workerOptions);

  logger.info(
    { taskQueue: env.TEMPORAL_TASK_QUEUE, namespace: env.TEMPORAL_NAMESPACE },
    'Temporal Worker: starting',
  );

  // run() blocks until the worker is stopped
  await worker.run();

  logger.info('Temporal Worker: stopped');
  await connection.close();
}
