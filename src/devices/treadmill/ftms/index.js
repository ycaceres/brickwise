/** Any treadmill with the standard Bluetooth Fitness Machine Service (FTMS). */
import { FtmsTreadmill } from './driver.js';

/** @type {import('../../types.js').DriverDescriptor} */
const descriptor = {
  id: 'ftms-treadmill',
  kind: 'treadmill',
  name: 'Treadmill (Bluetooth FTMS)',
  match: { services: ['fitness_machine'] },
  generic: true,   // a chosen treadmill no other driver recognizes is tried with FTMS
  capabilities: {
    speed: true, incline: true, decline: false,
    remoteStart: false,   // the belt starts from the console, like the EXP 5i (safety)
    remotePause: true,
    consoleHr: true,
  },
  // Until the treadmill reports its ranges (Supported Speed / Inclination Range)
  limits: { speedMin: 0.5, speedMax: 20, speedStep: 0.1, inclineMin: 0, inclineMax: 15, inclineStep: 0.5 },
  create: (events) => new FtmsTreadmill(events, descriptor),
};

export default descriptor;
