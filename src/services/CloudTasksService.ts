import { CloudTasksClient } from '@google-cloud/tasks';
import { config } from '../config/env';

export class CloudTasksService {
  private static client = new CloudTasksClient();
  private static queuePath = config.cloudTasksQueuePath;

  /**
   * Enqueue a task to Google Cloud Tasks
   * @param urlPath The internal URL path (e.g., '/api/v1/internal/tasks/send-message')
   * @param payload The JSON payload
   * @param scheduleTime Optional execution time in the future
   */
  public static async enqueueTask(urlPath: string, payload: any, scheduleTime?: Date): Promise<string | null> {
    if (!this.queuePath) {
      console.warn('[CloudTasks] CLOUD_TASKS_QUEUE_PATH is not set. Task will not be enqueued.');
      return null;
    }

    // Since this is a serverless environment, the Cloud Run instance URL needs to be injected or retrieved
    // In production, this should be the public URL of your API
    // For local dev with ngrok, set CLOUD_RUN_URL in .env
    const baseUrl = process.env.CLOUD_RUN_URL || 'http://localhost:3000';
    const url = `${baseUrl}${urlPath}`;

    const task: any = {
      httpRequest: {
        httpMethod: 'POST',
        url,
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify(payload)).toString('base64'),
      },
    };

    if (scheduleTime) {
      task.scheduleTime = {
        seconds: Math.floor(scheduleTime.getTime() / 1000),
      };
    }

    try {
      const request = {
        parent: this.queuePath,
        task,
      };
      const [response] = await this.client.createTask(request);
      console.log(`[CloudTasks] Created task ${response.name}`);
      return response.name;
    } catch (error) {
      console.error('[CloudTasks] Error creating task:', error);
      throw error;
    }
  }
}
