/** Smart trainer simulator: no Bluetooth, for development and tests (debug only). */
import { SimulatedTrainer } from './driver.js';

/** @type {import('../../types.js').DriverDescriptor} */
const descriptor = {
  id: 'simulated-trainer',
  kind: 'trainer',
  name: 'Simulated smart trainer',
  capabilities: { erg: true, resistance: true, simulation: true, cadence: true, speed: true },
  limits: { powerMin: 0, powerMax: 1500, powerStep: 1, resistanceMin: 0, resistanceMax: 100, gradeMin: -10, gradeMax: 20 },
  debugOnly: true,
  create: (events) => new SimulatedTrainer(events, descriptor),
};

export default descriptor;
