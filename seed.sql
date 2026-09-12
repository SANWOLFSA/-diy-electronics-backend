-- ============================================================================
-- DIY ELECTRONICS — LIVE MVP SCHEMA
-- This is a pragmatic, fast-to-deploy version of the full normalized schema
-- from Phase 5 (schema.sql). It stores each diagnostic/listing as a JSONB
-- payload so the existing frontend can bind to it with zero reshaping.
-- Migrate to the fully normalized tables later without changing the API
-- contract — only the query implementation inside server.js would change.
-- ============================================================================

CREATE TABLE IF NOT EXISTS diagnostics (
    device_id   TEXT PRIMARY KEY,
    payload     JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace_items (
    id          TEXT PRIMARY KEY,
    payload     JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
    id          SERIAL PRIMARY KEY,
    item_id     TEXT NOT NULL REFERENCES marketplace_items(id) ON DELETE CASCADE,
    stars       SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
    comment     TEXT NOT NULL,
    author      TEXT NOT NULL DEFAULT 'anonymous',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- DIAGNOSTICS — same three records the frontend already ships with locally
-- ---------------------------------------------------------------------------
INSERT INTO diagnostics (device_id, payload) VALUES
('pixel8pro', '{
  "brand": "Google", "model": "Pixel 8 Pro", "variant": "128GB, G1MNW, Global",
  "problem": "Boot loop", "problem_full": "Power/logic board failure — boot loop, will not stay powered on",
  "difficulty_level": 4, "success_rate_pct": 88.5, "confirmation_count": 214,
  "faulty_component": { "part_number": "SLPG7-A1", "type": "PMIC", "description": "Primary power management IC" },
  "component_coordinates": { "x_min": 0.42, "x_max": 0.58, "y_min": 0.31, "y_max": 0.44, "label": "U1500 — PMIC (SLPG7-A1)" },
  "board_label": "Pixel 8 Pro · Board Rev C",
  "video": { "title": "Pixel 8 Pro PMIC swap — full walkthrough (12:40)" },
  "test_measurements": [
    { "test_point": "PP_BATT_VCC (battery input rail)", "meter_mode": "DC Voltage", "expected_reading": "3.7V – 4.4V", "measured_reading": "4.02V (normal)", "verdict": "pass" },
    { "test_point": "PP_VDD_CORE (SoC core rail)", "meter_mode": "DC Voltage", "expected_reading": "0.85V – 1.1V", "measured_reading": "0.02V — dead short", "verdict": "fail" },
    { "test_point": "U1500 GND pins", "meter_mode": "Resistance (diode mode)", "expected_reading": "> 200Ω to ground", "measured_reading": "3Ω — short to ground", "verdict": "fail" }
  ],
  "safety_flags": ["Battery — disconnect before proceeding", "ESD sensitive", "High heat near display flex"],
  "repair_guide_steps": [
    { "step_index": 1, "instruction": "Discharge device fully, remove back glass.", "done": true },
    { "step_index": 2, "instruction": "Disconnect battery connector before any board work.", "done": true },
    { "step_index": 3, "instruction": "Force hard reset (Power + Vol Down, 10-15s) and attempt DC-injection bypass boot at PP_BATT_VCC.", "done": true },
    { "step_index": 4, "instruction": "Measure PP_VDD_CORE at TP2201; confirm short-to-ground on U1500.", "done": false, "current": true },
    { "step_index": 5, "instruction": "Remove U1500 with hot air at 380°C, clean pads.", "done": false },
    { "step_index": 6, "instruction": "Reball, reflow replacement PMIC, re-test before reassembly.", "done": false }
  ],
  "ic_alternatives": [
    { "part_number": "SLPG7-A1 (OEM pull)", "tier": "Exact match", "score": 99.0 },
    { "part_number": "SLPG7-A0 (prior rev)", "tier": "Firmware patch req.", "score": 76.0 },
    { "part_number": "SLPG6-A2 (Pixel 7 gen)", "tier": "Similar only — rework", "score": 41.0 }
  ]
}'::jsonb),

('qn55q60c', '{
  "brand": "Samsung", "model": "QN55Q60C QLED TV", "variant": "55-inch, BN44-01118A power board",
  "problem": "No power / 3-blink code", "problem_full": "Critical circuit failure — standby LED blinks 3x repeatedly",
  "difficulty_level": 3, "success_rate_pct": 91.2, "confirmation_count": 341,
  "faulty_component": { "part_number": "SBR20A100CT", "type": "Rectifier diode", "description": "Secondary-side Schottky rectifier, 12V rail" },
  "component_coordinates": { "x_min": 0.60, "x_max": 0.72, "y_min": 0.55, "y_max": 0.68, "label": "D8305 — Secondary rectifier" },
  "board_label": "Samsung BN44-01118A · Rev 1.2",
  "video": { "title": "Samsung QLED 3-blink power fix (8:15)" },
  "test_measurements": [
    { "test_point": "12V standby rail (CN8302 pin 2)", "meter_mode": "DC Voltage", "expected_reading": "12.0V ± 0.3V", "measured_reading": "1.1V — undervoltage", "verdict": "fail" },
    { "test_point": "D8305 anode-to-cathode", "meter_mode": "Diode mode", "expected_reading": "0.3V–0.5V fwd, OL rev", "measured_reading": "0.02V both directions — shorted", "verdict": "fail" },
    { "test_point": "Primary bulk capacitor C8801", "meter_mode": "DC Voltage", "expected_reading": "295V – 310V DC", "measured_reading": "302V (normal)", "verdict": "pass" }
  ],
  "safety_flags": ["High voltage — mains-connected board", "Discharge bulk capacitors before servicing"],
  "repair_guide_steps": [
    { "step_index": 1, "instruction": "Unplug TV, discharge bulk capacitors with bleeder resistor.", "done": true },
    { "step_index": 2, "instruction": "Remove power supply board, inspect capacitors for bulging.", "done": true },
    { "step_index": 3, "instruction": "Measure 12V standby rail at CN8302 on isolated test rig.", "done": false, "current": true },
    { "step_index": 4, "instruction": "Diode-test D8305 in-circuit; confirm short before desoldering.", "done": false },
    { "step_index": 5, "instruction": "Desolder shorted rectifier, install replacement.", "done": false },
    { "step_index": 6, "instruction": "Re-test 12V rail; confirm standby LED goes solid.", "done": false }
  ],
  "ic_alternatives": [
    { "part_number": "SBR20A100CT (OEM)", "tier": "Exact match", "score": 100.0 },
    { "part_number": "SS2H10-M3/86A (Vishay)", "tier": "Drop-in pin compatible", "score": 92.0 },
    { "part_number": "SK34A (generic TO-252)", "tier": "Requires rework", "score": 58.0 }
  ]
}'::jsonb),

('hse120xl', '{
  "brand": "De''Longhi", "model": "HSE120XL Ceramic Heater", "variant": "120V NA, control board Rev B",
  "problem": "E2 thermal sensor fault", "problem_full": "Thermal/sensor failure — E2 error, will not heat",
  "difficulty_level": 2, "success_rate_pct": 94.0, "confirmation_count": 156,
  "faulty_component": { "part_number": "B57861S0103F040", "type": "NTC thermistor", "description": "10kΩ ambient temperature sensor" },
  "component_coordinates": { "x_min": 0.18, "x_max": 0.27, "y_min": 0.72, "y_max": 0.83, "label": "TH1 — NTC ambient thermistor" },
  "board_label": "De''Longhi HSE120-CTRL-B",
  "video": { "title": "De''Longhi E2 thermistor replacement (5:52)" },
  "test_measurements": [
    { "test_point": "TH1 connector pins 1–2 (unplugged)", "meter_mode": "Resistance", "expected_reading": "~10,000Ω @ 25°C", "measured_reading": "OL (open circuit)", "verdict": "fail" },
    { "test_point": "Control board 5V sensor supply", "meter_mode": "DC Voltage", "expected_reading": "5.0V ± 0.1V", "measured_reading": "5.02V (normal)", "verdict": "pass" },
    { "test_point": "TH1 signal pin to ground (powered)", "meter_mode": "DC Voltage", "expected_reading": "~2.5V (divider mid-scale)", "measured_reading": "5.0V — pulled to rail", "verdict": "fail" }
  ],
  "safety_flags": ["Hot surface during test", "Unplug 2 min before opening housing"],
  "repair_guide_steps": [
    { "step_index": 1, "instruction": "Unplug unit, remove rear housing screws.", "done": true },
    { "step_index": 2, "instruction": "Locate TH1 connector; measure resistance with it unplugged.", "done": true },
    { "step_index": 3, "instruction": "Confirm OL reading vs expected ~10kΩ curve.", "done": false, "current": true },
    { "step_index": 4, "instruction": "Trace leads back to rule out broken wire vs failed bead.", "done": false },
    { "step_index": 5, "instruction": "Replace thermistor assembly, reconnect to TH1.", "done": false },
    { "step_index": 6, "instruction": "Run full heat cycle; confirm E2 clears and signal settles mid-scale.", "done": false }
  ],
  "ic_alternatives": [
    { "part_number": "B57861S0103F040 (OEM)", "tier": "Exact match", "score": 100.0 },
    { "part_number": "NTCLE100E3103JB0 (Vishay)", "tier": "Drop-in pin compatible", "score": 90.0 },
    { "part_number": "NTCLE203E3103SB0 (diff. B-value)", "tier": "Similar only — drift risk", "score": 55.0 }
  ]
}'::jsonb)
ON CONFLICT (device_id) DO UPDATE SET payload = EXCLUDED.payload;

-- ---------------------------------------------------------------------------
-- MARKETPLACE — matches the six listings already in the frontend
-- ---------------------------------------------------------------------------
INSERT INTO marketplace_items (id, payload) VALUES
('m1', '{"id":"m1","cat":"ic","name":"SLPG7-A1 PMIC · Pixel 8 Pro","seller":"circuitfix_co","sellerRating":4.9,"price":14.00,"verified":true,"desc":"OEM-pulled PMIC, tested for shorts before listing. Exact match for Pixel 8 Pro boot-loop repairs."}'::jsonb),
('m2', '{"id":"m2","cat":"ic","name":"SBR20A100CT rectifier","seller":"aparts_intl","sellerRating":4.7,"price":2.10,"desc":"New-stock Schottky rectifier for Samsung QLED power boards, SOD-123FL package."}'::jsonb),
('m3', '{"id":"m3","cat":"tool","name":"Hot air rework station 858D+","seller":"toolbench_ph","sellerRating":4.8,"price":89.00,"desc":"Adjustable temp + airflow hot air station, ESD-safe grounding cable included."}'::jsonb),
('m4', '{"id":"m4","cat":"board","name":"De''Longhi HSE120XL ctrl board","seller":"repair_lab_kr","sellerRating":5.0,"price":28.00,"desc":"Full replacement control board, pre-flashed, includes TH1 thermistor harness."}'::jsonb),
('m5', '{"id":"m5","cat":"ic","name":"NTC thermistor 10kΩ (Vishay)","seller":"chipvault","sellerRating":4.6,"price":3.75,"desc":"10kΩ @25°C NTC thermistor, drop-in for most ceramic heater control boards."}'::jsonb),
('m6', '{"id":"m6","cat":"tool","name":"Precision multimeter kit","seller":"testgear_uk","sellerRating":4.9,"price":34.00,"desc":"Auto-ranging multimeter with diode mode and continuity beep, includes fine-tip probes."}'::jsonb)
ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload;

INSERT INTO reviews (item_id, stars, comment, author) VALUES
('m1', 5, 'Tested clean, booted first try after reflow.', 'tech_marcus'),
('m3', 4, 'Runs a little hot at max temp but works great.', 'solderqueen');
