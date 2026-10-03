# Test Routes: driving test route practice

A web app (PWA) for iPhone that gives sat nav style, turn-by-turn directions around driving test routes. It's set up for **Nottingham (Chilwell)** test centre, with practice routes around **Tamworth & Polesworth** too, and you can switch to or add any other centre.

- **Common and popular routes.** Seven built-in Chilwell routes covering the roads learners report most: Bardills Island, the 70 mph A52, Bramcote Island, the Chilwell and Beeston tram roads, Attenborough Lane, Cator Lane, Beeston Rylands, Stapleford, Sandiacre and M1 junction 25. They are ranked by how often those roads come up. There are also eight **Tamworth & Polesworth** practice routes that cover the same kinds of road.
- **Sat nav style directions.** A big manoeuvre arrow with distance, roundabout diagrams that go clockwise UK-style and show the exit number, lane arrows, a countdown bar as you get close to each turn, "then" hints for close turns, and a white arrow painted on the map at each junction. UK voice prompts ("In 200 yards, turn left onto Barton Lane", "At the roundabout, take the third exit onto the A 52"), with an optional **examiner style** ("Take the second road on the left, please").
- **No U-turns.** A test route shouldn't make you turn round in the road. Routes are checked for U-turns when they're worked out, and the waypoints are nudged to design them out. The route screen says **No U-turns**, or warns you if one couldn't be removed. Reroutes avoid them too.
- **Off-route correction.** If you miss a turn it notices within a few seconds and works out a way back onto the rest of the test route. With no signal, it points you back to the blue line and picks the route up again when you rejoin it.
- **Keeps the screen on** while a route is running, using the Screen Wake Lock API with a fallback for older iOS.
- **Speed and limits.** Your speed, the speed limit from OpenStreetMap, and an optional warning if you go over it.
- **Practice at home.** A simulated drive along any route, with speed-up and a "wrong turn" button to see rerouting.
- **Mock test.** A random route with the name hidden. It uses examiner directions, with about 20 minutes of independent driving following the sat nav in the middle.
- **Change centre later.** Search for any test centre, then add routes by tapping roads on the map, by recording a drive with your instructor, or by letting the app make a practice loop. Routes and centres can be backed up and shared as files.
- **Works offline** once set up: routes are saved on the phone, and the map for the area can be downloaded in Settings.

## Put it on your iPhone

1. Open the app's web address in **Safari** (see *Hosting* below for the address).
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. Open **Test Routes** from your home screen. Allow location access when asked ("While Using the App").
4. With a good signal, open the app once and wait for **Preparing routes for offline use** to finish. Then go to **Settings › Download map** for the area. After that it works with no signal.

Updates install themselves: the next time you open the app with a signal it reloads with the new version (never in the middle of a drive). After an update, routes are worked out again in the background, so leave it on the home screen for a minute with a signal. Until then it uses the routes it saved before.

### In the car

- Mount the phone and set the route up **before** you move off. Only drive with a qualified supervisor, as the law requires for learners.
- Tap **Start route**. If you're not at the start, it offers to take you there first or to join the route nearest you.
- Tap the green banner to repeat the last direction. The speaker button mutes the voice, and the map button shows the whole route.
- The screen stays on while a route runs. If iOS ever drops it, a small note under the arrival time says so; tap it to turn it back on.

### Voice not working?

- Turn the volume up with the side buttons while the app is open.
- iPhone mutes web app speech when it's on **Silent**. **Settings › Speak in Silent Mode** (on by default) asks iOS to play directions anyway. If you still hear nothing, take the phone off Silent.
- Choose **Settings › Voice › Standard British voice**. iOS lists some voices that aren't downloaded, and those stay silent. If a chosen voice doesn't start, the app switches to the standard one. You can download better voices in the iPhone's **Settings › Accessibility › Spoken Content › Voices**.
- **Settings › Test voice** tells you whether speech started.
- iOS only lets speech start after a tap, so the app says "Starting route" as you tap **Start route**. If you don't hear that, check the points above before you drive.

## The Chilwell routes

| # | Route | What it covers |
|---|-------|----------------|
| 1 | Bardills Island & the A52 ★ | Toton, Bardills Island, 70 mph A52, Bramcote Island, Stapleford crossroads |
| 2 | Chilwell High Road & Beeston ★ | Attenborough Lane, Chilwell High Road, trams on Chilwell Road, Beeston, Queens Road |
| 3 | Cator Lane, Bramcote Island & the A52 | Tram crossing, speed changes, Bramcote Island, A52 west |
| 4 | Beeston Rylands & the level crossing | Level crossing by Beeston station, 20 mph estate roads, manoeuvre practice |
| 5 | M1 junction 25, Sandiacre & Stapleford | M1 J25 roundabout, Bostocks Lane, Derby Road, Toton Lane |
| 6 | Stapleford & Ilkeston Road | Stapleford town centre, Church Street, Ilkeston Road, Bramcote Island |
| 7 | Chilwell & Toton estates | Swiney Way, Inham Road, Eskdale Drive, Bramcote Lane, tram crossings |

DVSA stopped publishing test routes in 2017, so these are built from the roads and junctions that learners and instructors most often report for Chilwell. Your actual test may use different roads. Practising the *types* of road is what matters.

The routes are written like an examiner's route card: "Barton Lane between Nottingham Road and Eldon Road", or "the A52 heading east near here". The first time each route is opened, the app finds those exact roads in OpenStreetMap, works out the drive and saves it on the phone. If a road can't be found, the route preview says so. You can then use **Edit a copy** to drag the waypoints, or **Recalculate route**.

## The Tamworth & Polesworth practice routes

These are practice loops, not test routes. Each one copies the mix of roads in one of the Chilwell routes: the Egg instead of Bardills Island, the A5 instead of the A52, M42 junction 10 instead of M1 junction 25, and Polesworth's village streets instead of the Chilwell estates. They start and finish at Tamworth station or in Polesworth.

| # | Route | Starts | What it covers |
|---|-------|--------|----------------|
| 1 | The Egg, Riverdrive & the A5 ★ | Tamworth station | The Egg, Riverdrive dual carriageway, Bonehill Road, 70 mph A5, Stonydelph, Glascote |
| 2 | Tamworth town centre ★ | Tamworth station | Upper Gungate, Aldergate, Lichfield Street, the Egg, Albert Road |
| 3 | M42 junction 10, Dordon & Polesworth ★ | Polesworth | Grendon Road, 70 mph A5, M42 J10 roundabout, Pennine Way, B5000 |
| 4 | Ventura Park & Bonehill roundabout | Tamworth station | Busy retail roundabouts, Bonehill roundabout with lights, Riverdrive |
| 5 | Polesworth village & Dordon | Polesworth | Narrow streets by the abbey, parked cars, Station Road, Dordon |
| 6 | Glascote, Stonydelph & Amington | Tamworth station | Estate roads, mini roundabouts, parked cars, manoeuvre practice |
| 7 | Polesworth to the Egg & the A5 | Polesworth | B5000 country road, the Egg, Riverdrive, A5, M42 J10 |
| 8 | Wilnecote & Two Gates | Tamworth station | Old Watling Street, side roads, bus stops, Glascote |

They're for practising near home: your test centre stays Chilwell. Switch between the two with the centre name on the home screen.

## Switching test centre

Open the centre name on the home screen to get **Test centres**:

- **Search** by name or postcode, or **use where I am now**, to add a centre.
- Then add routes:
  - **Create route**: tap the roads you want to drive, in order. It snaps to roads and shows the route as you go.
  - **Record a drive**: start recording, drive a route (for example a mock test with your instructor), then tap Stop to save it as a route you can follow later.
  - **Make a practice loop**: the app picks a loop of roads around the centre. Make another for a different mix.
- **Settings › Back up** saves everything to a file, and **Import** loads it on another phone. A file in the same format as `data/centres/nottingham-chilwell.json` can be imported as a whole new centre with its routes.

### Adding a built-in centre (for developers)

Add a JSON file to `data/centres/`, list it in `data/centres/index.json`, and add both to `SHELL` in `sw.js`. Waypoints can be:

```jsonc
{ "road": "Barton Lane", "near": [-1.2395, 52.906], "from": "Eldon Road", "to": "A6005" } // a road between two junctions
{ "ref": "A52", "near": [-1.252, 52.9258], "bearing": 55 }                               // a road number, heading a set way (picks the right carriageway)
{ "at": [-1.2383, 52.9047] }                                                             // an exact point
```

`near` only needs to be within `radius` metres (default 700) of the stretch you mean. Centres can also have `hotspots` (spoken warnings when you get close) and `tips`. A practice area (routes that don't start from a test centre) sets `"practice": true`, and its routes can each set `start`, `end` and `destinationName` (see `data/centres/tamworth-polesworth.json`).

## How it works

- Plain HTML, CSS and JavaScript modules with no build step. The map uses [MapLibre GL JS](https://maplibre.org) with free [OpenFreeMap](https://openfreemap.org) vector tiles, which need no account or key.
- Routing uses the public [OSRM](https://project-osrm.org) server, with [Valhalla](https://valhalla.github.io/valhalla/) (FOSSGIS) as a backup. Speed limits come from Valhalla map matching, and waypoint roads are looked up through the [Overpass API](https://overpass-api.de). All of these are free OpenStreetMap services with fair-use limits. The app only calls them when it prepares a route or needs to reroute.
- The navigation logic (`js/nav/`) matches GPS fixes to the route, schedules voice prompts and detects leaving the route. It is plain JavaScript with unit tests.
- Roundabout exits are worked out from the shape of the road, so the diagram points the way you actually leave, with the exit number on it.
- U-turns are found in the routing result (including turning round at a waypoint), then the app tries a few fixes: setting off the other way, moving or relaxing the waypoint nearby, or adding a point just past the turn. It keeps whichever version has fewest U-turns without making the route much longer.
- No accounts and no tracking. Your routes, settings and history stay on your phone.

## Hosting

The app is static files, so any HTTPS host works. With GitHub Pages:

1. On GitHub, go to the repository's **Settings › Pages**.
2. Under *Build and deployment*, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After a minute it's live at `https://asmyth7274.github.io/DrivingRoutes/`.

When you change files, bump the version in both `js/version.js` and `sw.js` so phones pick up the update.

## Development

```bash
npm test                 # unit tests (Node 20+, no dependencies)
python3 -m http.server   # then open http://localhost:8000
node tools/e2e.mjs       # browser test at iPhone size with fake map/routing services (needs Playwright)
node tools/make-icons.mjs  # rebuild the PNG icons from icons/icon.svg
```

## Limitations

- These are practice routes, not official ones. Always follow road signs, road markings, the police and your examiner over the app.
- The built-in routes were planned on a map, not driven. If a road can't be found or a U-turn can't be designed out, the route screen says so. Use **Edit a copy** to fix it, and check the **Directions** list before you set off.
- Speed limits come from OpenStreetMap and can be missing or out of date. They're a guide only.
- The free routing and map services occasionally go down or limit requests. Prepared routes and downloaded maps keep working offline, but rerouting needs a signal.
- On iPhone, guidance pauses if you lock the phone or switch apps, because iOS stops web apps in the background. The screen-on setting is there to prevent that.

## Credits

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Map tiles: OpenFreeMap. Map rendering: MapLibre GL JS (BSD-3-Clause, see `vendor/maplibre-gl/LICENSE.txt`). Screen-on fallback video from NoSleep.js (MIT).
