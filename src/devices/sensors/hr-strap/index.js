/** Any standard Bluetooth heart rate strap (Heart Rate service 0x180D), with RR intervals. */
import { HeartRateStrap } from './driver.js';

/** @type {import('../../types.js').DriverDescriptor} */
export default {
  id: 'hr-strap',
  kind: 'hr',
  name: 'Heart rate monitor (Bluetooth)',
  match: { services: ['heart_rate'] },
  capabilities: { hr: true, rr: true, contact: true },
  limits: {},
  create: (events) => new HeartRateStrap(events),
};
