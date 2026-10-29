# Device drivers

Every treadmill, smart trainer and sensor Brickwise talks to is a **driver**: a folder with the code that speaks its protocol and a **descriptor** (`index.js`) that says what it is, how to find it and what it can do. The session engine and the screens only use the common interface, so a new brand or model never touches them. Simulators are drivers too (`debugOnly`), which is how development and tests run without hardware.

```
src/devices/
  types.js                 the contract (JSDoc typedefs)
  registry.js              every driver, by kind
  ble/                     shared Web Bluetooth helpers
  treadmill/
    nordictrack-exp5i/     driver.js, protocol.js, messages.js, index.js
    simulated/             driver.js, index.js (debug only)
  trainer/                 smart trainers (#23)
  sensors/
    hr-strap/              driver.js, index.js
```

## Adding a driver

1. **Folder:** `src/devices/<kind>/<brand-model>/` with `driver.js` (the class), `protocol.js` (pure packet building / parsing, so it can be unit tested) and `index.js` (the descriptor).
2. **Descriptor** (see `DriverDescriptor` in `types.js`):
   ```js
   export default {
     id: 'brand-model',            // lowercase, dashes
     kind: 'treadmill',            // 'treadmill' | 'trainer' | 'hr' | 'power' | 'cadence'
     name: 'Brand Model (protocol)',
     match: { namePrefix: ['ABC'], services: ['fitness_machine'] },   // how to find and recognize it
     capabilities: { speed: true, incline: true, remoteStart: false, remotePause: true },
     limits: { speedMin: 1, speedMax: 18, speedStep: 0.1, inclineMin: 0, inclineMax: 12, inclineStep: 0.5 },
     create: (events) => new BrandModelTreadmill(events),
   };
   ```
3. **Register it:** one import and one entry in `DRIVERS` in `registry.js`.
4. **Events:** call `onStatus('connecting' | 'initializing' | 'ready' | 'disconnected' | 'error', detail)`, `onData(state)` with every reading (always set `state.updatedAt = Date.now()`), `onInfo(info)` and `onLog(kind, text)`.
5. **Connect:** `connect({ device })` may receive a Bluetooth device already chosen by the app (one chooser for every driver of a kind); without it, the driver calls `navigator.bluetooth.requestDevice` with its own `match`. Use `ble/gatt.js` (`connectGatt`, `subscribe`) and `ble/write-queue.js` (`createWriteQueue`) instead of re-implementing them.
6. **Safety:** `pause()` stops the belt (or releases the trainer); `pauseNow()` must be synchronous and safe when not connected (it runs while the page closes).
7. **Tests:** `tests/devices.test.mjs` runs the shared checks in `tests/devices/contract.mjs` on every registered driver (descriptor sanity; full lifecycle for drivers that run without Bluetooth). Add protocol tests for `protocol.js` with real captures, like `tests/treadmill.test.mjs` does for iFit.
8. **Hardware:** test against the real device, or an emulator (for FTMS, a GATT server profile in nRF Connect or zwack). Do not change a driver proven on hardware without testing on it again.

Normalized state fields and the `Treadmill` / `Trainer` base classes come with #13 and #23.
