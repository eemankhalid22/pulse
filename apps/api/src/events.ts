import { pub, EVENTS_CHANNEL } from "./redis";

export type PulseEvent = {
  type: string;
  userId?: string; // if set, only that user's sockets receive it
  data: unknown;
};

export async function publishEvent(event: PulseEvent) {
  await pub.publish(
    EVENTS_CHANNEL,
    JSON.stringify({ ...event, ts: new Date().toISOString() }),
  );
}
