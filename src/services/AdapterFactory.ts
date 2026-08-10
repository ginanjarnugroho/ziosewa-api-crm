import { MessagingChannelAdapter } from '../interfaces/MessagingChannelAdapter';
import { WahaAdapter } from '../adapters/WahaAdapter';

export class AdapterFactory {
  private static instances: Map<string, MessagingChannelAdapter> = new Map();

  public static getAdapter(channelType: string): MessagingChannelAdapter {
    let adapter = this.instances.get(channelType);
    if (!adapter) {
      if (channelType === 'wa_unofficial') {
        adapter = new WahaAdapter();
        this.instances.set(channelType, adapter);
      } else {
        throw new Error(`Unsupported channel type: ${channelType}`);
      }
    }
    return adapter;
  }
}
