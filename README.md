# Treadwise

Controls the speed and incline of a NordicTrack EXP 5i treadmill over Bluetooth and automatically runs the running workouts planned in Intervals.icu. When you finish, it uploads the activity paired with the workout.

**Live app:** https://ycaceres.github.io/treadwise/

> Treadwise is an independent project, not affiliated with iFIT Inc. NordicTrack and iFit are trademarks of their respective owners.

## Usage

It is a static page: it needs no backend of its own. Web Bluetooth only works over HTTPS or on `localhost`, in Chrome or Edge (desktop or Android; not Safari on iPhone/iPad).

To run it locally:

```bash
git clone https://github.com/ycaceres/treadwise.git
cd treadwise
npm start            # python3 serve.py 8000; open http://localhost:8000
```

`serve.py` is for development only: it enlarges the connection queue (with `python3 -m http.server` macOS drops some module downloads and the app does not start), listens on IPv4 and IPv6 and disables caching. If a module download still fails, the page reloads itself up to twice and then shows a notice.

**Deploy:** the repository root is the site, with no build step. It is published with GitHub Pages from the `main` branch, so every push to `main` updates the live app in a minute or two. Any other static host with HTTPS (Netlify, Cloudflare Pages) works the same way.

**Intervals.icu:** in **Profile**, paste your API key (Intervals.icu → Settings → Developer Settings) and press **Sign in**. The page calls the Intervals.icu API directly, which accepts cross-origin requests. The key is stored only in that browser's `localStorage`: it is not in the code or on the host. If someone might have seen it, regenerate it in Intervals.icu and press **Sign out**. Without a key, the library, the manual profile and the TCX download still work.

The page has three tabs, shown as icons:

- **Profile (person):** works like a sign-in. Signed out, you paste your Intervals.icu API key and press **Sign in**, or enter threshold pace, LTHR and max HR by hand (without LTHR it is estimated as 91 % of max HR). Signed in, you see your Intervals.icu name, photo and city, your key data (threshold pace, LTHR, max HR, resting HR and weight), the zone table, **Refresh** and **Sign out**. Signing out deletes the key and keeps the data as a manual profile.
- **Workouts (clipboard):** the runs planned in Intervals.icu for the chosen day and the library (`library.json`), with three dropdowns to filter by duration (30, 45 or 60 min), type and level (1–5). Workouts are in % of threshold pace and zones, so they adapt to the profile; Intervals workouts also use the profile's threshold when their steps are in % or zones. Here you choose the pace within the zone, the base incline and whether speed is adjusted by HR.
- **Train (runner):** a bar with distance, time and HR, the buttons ▶ start, ⏭ skip step, ■ finish, download (CSV or TCX) and upload to Intervals.icu, and incline and pace with their + and − buttons (0.5 % and 0.5 km/h); below, a line with the session status and the chart.
- **Debug (bug):** only shows when the page is opened with `?debug=true`. It has the treadmill state and the communication log.

1. Turn on the treadmill, attach the safety key and, on the **Treadmill** pill at the top, choose **Connect treadmill** (it shows up as `I_TL…`). Activation takes ~10 s.
2. Optional: press the **HRM** pill (any standard Bluetooth heart rate monitor).
3. Pick the workout in **Workouts** and press **Go train**.
4. Press **▶ (start)** and then **START on the console**. The workout begins when the belt moves.
5. When done: the **upload to Intervals.icu** icon (needs the API key) or the **download** icon (CSV or TCX). Library workouts are uploaded unpaired.

**Simulation mode** (in the Treadmill pill menu) tests everything without the treadmill (including a simulated HR if no strap is connected).

## Library (`library.json`)

To add or tweak workouts only `library.json` is edited; the page reads it on load. Each **type** generates one workout per duration in `durations` and per level in `levels`, and the **featured** ones (`featured`) are fixed workouts, written step by step.

**Segment** (one step), used everywhere:

| Field | Example | Meaning |
|---|---|---|
| `dur` | `"2m"`, `"1m30s"`, `"90s"` | duration |
| `pace` | `72`, `[104, 108]` | % of threshold pace (a range is a ramp if `"ramp": true`) |
| | `"Z2"` | profile pace zone |
| | `"12:00"` | fixed pace in min/km (does not depend on the profile) |
| `hr` | `"Z2"` | target HR zone |
| `incline` | `5` | incline in % (without it the base incline is used) |
| `lock` | `true` | HR does not change the speed (it is only the goal) |
| `ramp` | `true` | pace goes from the first to the second `pace` value |

**Type:**

```json
{
  "id": "vo2", "name": "VO2max intervals", "description": "…",
  "warmup": { "dur": "10m", "pace": [70, 80], "ramp": true },   // optional; if missing, the one in "defaults"
  "warmup30": { … },                                             // optional, for 30 min
  "cooldown": null,                                              // null = no cooldown
  "levels": { "1": { …recipe… }, "2": { … }, … }
}
```

**Recipes** (`kind`):

- `"continuous"`: `main` (a segment without `dur`) fills the time; optional `finish` with `reps`, `work` and `recovery` at the end (strides).
- `"intervals"`: `work` and `recovery`. Without `reps`, as many as fit (up to `maxReps`); with `reps`, a fixed number. Leftover time lengthens the warm-up and cooldown.
- `"incline-ramp"`: fixed `pace`; incline goes from `from` to `to`, adding `step` every `every`, and holds at the top until the end. `hr` is the goal (speed does not change).
- `summary` (optional) replaces the automatic summary ("6 × 3′ at 104–108 % · 2′ easy").
- `byDuration` adjusts the level for one duration: `"byDuration": { "30": { "reps": 2, "work": { "dur": "7m" } } }`.

**Featured:** `id`, `name`, `description`, `type`, `minutes`, `level` (for the filters) and `steps`, a list of segments (`"warmup": true` or `"cooldown": true` mark the warm-up and cooldown).

`npm test` checks that every combination lasts what it says and that hard work grows with level in interval sessions.

## Chart

A single area, Auuki style. The **?** button explains the colors.

- **In the background, the whole workout:** one block per step; width is duration, height is target speed and color is the zone. What is done gets dimmed and a vertical bar marks progress.
- **On top, the actual data:** pace, HR and incline, growing as you run.
- **Left axis:** pace in min/km. **Right axis:** HR in bpm. Both columns are shaded with each zone's color and, with zones in the profile, they line up: the HR scale is stretched piecewise so the top of each HR zone lands at the height of the top of the same pace zone. The current zone shows above each column.
- **Zone colors:** Z1 gray, Z2 blue, Z3 green, Z4 yellow, Z5 orange, Z6 red, Z7 violet.
- Dashed lines mark the plan: each step's HR cap (or goal) and the planned incline.
- **Download** (icon next to ■): second-by-second CSV or TCX; enabled when the session ends.

## Heart rate variability (DFA α1)

With a chest strap that sends RR intervals (time between beats; nearly all do: Polar H9/H10, Garmin HRM, Wahoo TICKR), the page computes the **DFA α1** of the last 2 minutes every 5 s (`hrv.js`):

- **> 0.75:** below the aerobic threshold (aerobic). **0.5–0.75:** transition. **< 0.5:** above the anaerobic threshold.
- It shows to the right of HR in the bar and as a **color ribbon under the chart**. Gray: computing (~90 beats needed) or a signal with more than 5 % artifacts (missed or double beats; common with a dry strap).
- The CSV stores `alpha1` and each second's RRs (`rr_ms`, separated by `;`). TCX has no field for RRs, so they do not reach Intervals.icu yet.
- With an optical sensor or no strap nothing shows. Simulation mode generates test RRs.

## Zones and HR adjustment

On load, the running HR and pace zones are read from Intervals.icu (running sport-settings) and shown on the workout card. With **Adjust speed by HR** on:

- **Steps with a pace target:** the HR cap is that of the HR zone in the same position (pace Z2 → HR Z2). If HR goes above that cap, speed drops 0.2 km/h, up to 2 km/h in total. When HR is back 5 bpm below the cap, the removed speed returns.
- **Steps with an HR target:** the starting speed comes from the matching pace zone. Then it goes up or down 0.2 km/h to keep HR in range (at most +1.5 km/h and −2 km/h).
- HR must be out of range for 15 s in a row before an adjustment, and at least 25 s pass between adjustments. Nothing is adjusted in the first 45 s of each step, because HR takes time to respond. Every adjustment is logged.

## Safety
- The belt is started only from the console, with the safety key attached (same as qdomyos-zwift with this model).
- **■ (finish)**, and also the end of the workout's last step, **pause** the belt (they write Mode = 3, like the console's pause button). From the console you can resume or finish. The EXP 5i rejects speed 0 with code 4, so it is not used. If the treadmill does not respond, STOP on the console or pulling the key is still required.
- **Closing or reloading the page** during an active workout pauses the belt (Mode = 3). The command goes out when the browser asks whether to leave; if you stay, the session remains paused and START on the console resumes it. It is best effort: if the browser closes abruptly (or hangs), the command may not arrive.
- If the belt stops for more than 2 s, the session pauses. If the connection drops or data stops arriving, no distance is counted.
- Speed is limited to 0.8–16 km/h and incline to 0–10 %.
- **The screen stays on** from ▶ until the session ends (Screen Wake Lock API). The browser drops the lock whenever the page is hidden, so it is requested again when you come back to it. If the browser cannot keep the screen on (no Wake Lock support, or battery saver mode), a note under the controls says so: turn off auto-lock in the device settings.

## Files

| File | What it does |
|---|---|
| `exp5i-protocol.js` | iFit protocol packets for the EXP 5i: init and activation, polling cycle, speed and incline |
| `ifit-messages.js` | Full decoding: reassembles multi-packet messages, pairs each response with its request and reads every field (table from [ianchi/ifit](https://github.com/ianchi/ifit)) |
| `treadmill.js` | Web Bluetooth connection (write queue, retries), simulator and HRM |
| `workout.js` | Turns the Intervals.icu `workout_doc` into speed steps |
| `tcx.js` | Builds the session TCX |
| `app.js`, `index.html` | UI and workout execution |
| `timer.js` | Timers in a Web Worker, which keep running with the tab in the background |
| `chart.js` | Chart of actual data over the workout by zones (SVG, no libraries) |
| `zones.js` | Profile, HR and pace zones, HR ranges of each step and resolution of relative paces |
| `library.json` | The workout library (data; edited by hand) |
| `library.js` | Turns `library.json` into workouts for every duration and level |
| `hrv.js` | RR intervals: artifact cleanup and DFA α1 |
| `intervals.js` | Intervals.icu API calls from the browser: workouts, zones and activity upload, with the API key stored in the browser |
| `serve.py` | Static server for local development (not deployed) |
| `test.mjs` | Hardware-free tests: `npm test` |

## Protocol origin

Everything comes from qdomyos-zwift's `nordictrack_treadmill_exp_5i` profile ([source](https://github.com/cagnulein/qdomyos-zwift/blob/master/src/devices/proformtreadmill/proformtreadmill.cpp)), built from a real capture of an EXP 5i ([issue #2502](https://github.com/cagnulein/qdomyos-zwift/issues/2502)). The message format is in [ianchi/ifit](https://github.com/ianchi/ifit/blob/main/docs/IFIT_PROTOCOL.md).

- **Activation:** 25 packets. They include command `0x90` with a 36-byte code; without it, the treadmill ignores commands.
- **Polling:** a 6-packet cycle every 200 ms. Speed and incline are only sent on step 2.
- **Speed:** `ff 0d 02 04 02 09 04 09 02 01 01 <lo> <hi> 00 <cs>`, in km/h×100 with `cs = lo + hi + 0x11`.
- **Incline:** same packet with `02` in byte 10, in %×100 with `cs = lo + hi + 0x12`.
- **Responses:** arrive in several packets (`fe 02 <length> <n>`, then `00 12 …`, `01 12 …`, `ff …`). They are reassembled and decoded according to the fields the request asked for.
- **Polling cycle:** the first message asks for fields 7, 11, 22, 103 and 116 (uptime, paused time…). The second asks for fields 0, 1, 4, 9, 10, 12, 15, 16, 20, 21, 46, 52, 71, 75, 76 and 96. Among them are requested and actual speed, incline, distance, pulse, mode, time and calories. Its response is 50 bytes long and starts with `00 12 01 04 02 2e`, the packet qdomyos-zwift filters on.
- **Mode:** 1 idle, 2 running, 3 paused, 4 summary, 8 safety key missing, 10 warm-up.
- **Equipment info:** on connect, firmware, serial number, model and the list of supported fields are read.
- **Limits:** on connect, the treadmill's minimum and maximum speed and incline are read (fields 27, 28, 30 and 31), and commands are clamped to them.
- **Actual speed:** on the EXP 5i (firmware 0.1.06122017.0908) field 16 is always 0. With the console running, the requested speed (field 0) is used, which the treadmill confirms in every response.
- **Background tab:** timers run in a Web Worker, so the polling cycle does not slow down when the tab is hidden.

## Troubleshooting

Open the page with `?debug=true` (for example https://ycaceres.github.io/treadwise/?debug=true) and go to the **Debug** tab. Look at **Treadmill state** first. The **mode** tells you whether the console is running, paused or missing the key, and the equipment info confirms that activation got a response.

Then open **Communication log**, tick **Show TX/RX packets** and use **Download log**. The log includes:
- every decoded response (`= {…}` lines);
- mode changes;
- `Accepted: {"Kph":…}` when the treadmill confirms a speed;
- a warning with the status code when it rejects one.

If the treadmill does not respond, the most likely culprit is the activation code: qdomyos-zwift captured it on a different EXP 5i. In that case you need to capture your unit's code with `ifit discover-activation` from the [`ifit`](https://pypi.org/project/ifit/) package, or with an Android HCI log while using the iFit app.

## References

Open-source projects consulted while building Treadwise:

| Repository | What it contributed |
|---|---|
| [cagnulein/qdomyos-zwift](https://github.com/cagnulein/qdomyos-zwift) | The EXP 5i activation sequence, polling cycle and speed/incline packets (`nordictrack_treadmill_exp_5i` profile), captured from a real unit |
| [ianchi/ifit](https://github.com/ianchi/ifit) ([PyPI](https://pypi.org/project/ifit/)) | The iFit message format, characteristics table and response decoding used in `ifit-messages.js`; its `ifit discover-activation` command captures a unit's activation code |
| [dawsontoth/zwifit](https://github.com/dawsontoth/zwifit) | An earlier iFit treadmill bridge, reviewed to understand the BLE protocol |
| [cagnulein/QZCompanionNordictrackTreadmill](https://github.com/cagnulein/QZCompanionNordictrackTreadmill) | Companion app for NordicTrack treadmills, reviewed for alternative connection methods |
| [nategreco/uBike](https://github.com/nategreco/uBike) | Console replacement firmware for NordicTrack equipment, reviewed for the low-level protocol |
| [dvmarinoff/Auuki](https://github.com/dvmarinoff/Auuki) | Web Bluetooth trainer app whose workout graph inspired the session chart |

Workouts, zones and uploads use the [Intervals.icu API](https://intervals.icu/api-docs.html).
