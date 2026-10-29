/** NordicTrack EXP 5i (and iFit treadmills that speak the same Bluetooth protocol). */
import { Exp5iTreadmill } from './driver.js';
import { SERVICE_UUID, LIMITS } from './protocol.js';

/** @type {import('../../types.js').DriverDescriptor} */
const descriptor = {
  id: 'nordictrack-exp5i',
  kind: 'treadmill',
  name: 'NordicTrack EXP 5i (iFit Bluetooth)',
  match: { namePrefix: ['I_'], services: [SERVICE_UUID] },
  capabilities: {
    speed: true, incline: true, decline: false,
    remoteStart: false,   // the belt starts from the console only (safety key)
    remotePause: true,
    consoleHr: true,      // HR from the hand grips or a strap paired with the console
    distance: true, calories: true,
  },
  limits: { speedMin: LIMITS.speedMin, speedMax: LIMITS.speedMax, speedStep: 0.1, inclineMin: LIMITS.inclineMin, inclineMax: LIMITS.inclineMax, inclineStep: 0.5 },
  create: (events) => new Exp5iTreadmill(events, descriptor),
};

export default descriptor;
