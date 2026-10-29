/**
 * The contract every device driver follows (JSDoc only, nothing runs here).
 * See src/devices/README.md for how to add a driver.
 *
 * @typedef {'treadmill' | 'trainer' | 'hr' | 'power' | 'cadence'} DeviceKind
 *
 * @typedef {'connecting' | 'initializing' | 'ready' | 'disconnected' | 'error'} DeviceStatus
 *
 * @typedef {object} Capabilities   What the device can do; the UI shows controls from it.
 * @property {boolean} [speed]        treadmill: target speed
 * @property {boolean} [incline]      treadmill: target incline
 * @property {boolean} [decline]      treadmill: incline below 0 %
 * @property {boolean} [remoteStart]  the app may start the belt (false: console only)
 * @property {boolean} [remotePause]  the app may stop the belt
 * @property {boolean} [consoleHr]    the console reports HR (hand grips or paired strap)
 * @property {boolean} [erg]          trainer: target power
 * @property {boolean} [resistance]   trainer: resistance level
 * @property {boolean} [simulation]   trainer: grade / wind simulation
 * @property {boolean} [cadence]      reports cadence
 * @property {boolean} [hr]           reports HR
 * @property {boolean} [rr]           reports RR intervals
 *
 * @typedef {object} Limits   Ranges the device accepts (commands are clamped to them).
 * @property {number} [speedMin] @property {number} [speedMax] @property {number} [speedStep]       km/h
 * @property {number} [inclineMin] @property {number} [inclineMax] @property {number} [inclineStep] %
 * @property {number} [powerMin] @property {number} [powerMax] @property {number} [powerStep]       W
 * @property {number} [resistanceMin] @property {number} [resistanceMax]                            %
 * @property {number} [gradeMin] @property {number} [gradeMax]                                      %
 *
 * @typedef {object} DriverDescriptor   One per driver, listed in registry.js.
 * @property {string} id              stable id, e.g. 'nordictrack-exp5i'
 * @property {DeviceKind} kind
 * @property {string} name            shown in the connect menu
 * @property {{ namePrefix?: string[], services?: string[], optionalServices?: string[] }} [match]
 *           how to find it with navigator.bluetooth.requestDevice and how to recognize it (required unless debugOnly)
 * @property {Capabilities} capabilities
 * @property {Limits} limits
 * @property {boolean} [debugOnly]    simulators: only listed with ?debug=true
 * @property {(events: DeviceEvents) => Device} create
 *
 * @typedef {object} DeviceEvents   Callbacks a driver calls (all optional).
 * @property {(status: DeviceStatus, detail?: string) => void} [onStatus]
 * @property {(state: object) => void} [onData]   new readings (normalized fields: see #13)
 * @property {(info: object) => void} [onInfo]    model, firmware, serial…
 * @property {(kind: string, text: string) => void} [onLog]
 * @property {() => void} [onControlLost]       trainers: another app took control
 *
 * @typedef {object} TreadmillState   What treadmill drivers publish with onData (plus their own fields).
 * @property {number} speed            actual km/h
 * @property {number} incline          actual %
 * @property {number} [targetSpeed]    requested km/h as the treadmill reports it
 * @property {number} [distance] @property {number} [time]   console counters (m, s)
 * @property {'running' | 'paused' | 'stopped'} [belt]
 * @property {string[]} [alerts]       e.g. 'safety-key-missing'
 * @property {number | null} [hr] @property {'console' | null} [hrSource]
 * @property {number} updatedAt        ms
 *
 * @typedef {object} TrainerState   What smart trainer drivers publish with onData (plus their own fields).
 * @property {number} power  W @property {number} cadence  rpm @property {number} speed  km/h
 * @property {number} distance  m @property {number} elapsed  s
 * @property {'erg' | 'resistance' | 'simulation' | 'idle'} mode
 * @property {boolean} controlled   this app holds control of the trainer
 * @property {number | null} [hr] @property {string | null} [hrSource]
 * @property {number} updatedAt
 *
 * @typedef {object} Device
 * @property {(opts?: { device?: object }) => Promise<void>} connect   opts.device: a BluetoothDevice already chosen
 * @property {() => void} disconnect
 * @property {boolean} connected
 * @property {object} [info]
 * @property {object} [state]   latest readings, with updatedAt (ms)
 * @property {() => Array<[string, string]>} [diagnostics]   rows for the Debug page
 * @property {Capabilities} [capabilities] @property {Limits} [limits]   from the descriptor (limits may narrow after connecting)
 * @property {(t: { speed?: number, incline?: number, power?: number }) => void} [setTarget]   clamped to limits
 */
export {};
