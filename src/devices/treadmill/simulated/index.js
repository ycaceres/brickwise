/** Treadmill simulator: no Bluetooth, for development and tests (debug only). */
import { SimulatedTreadmill } from './driver.js';
import exp5i from '../nordictrack-exp5i/index.js';

/** @type {import('../../types.js').DriverDescriptor} */
export default {
  id: 'simulated-treadmill',
  kind: 'treadmill',
  name: 'Simulated treadmill',
  capabilities: { ...exp5i.capabilities },   // behaves like the EXP 5i
  limits: { ...exp5i.limits },
  debugOnly: true,
  create: (events) => new SimulatedTreadmill(events),
};
