# Proposed lettered ride tiers — awaiting Melody's decision

This is a **proposal**, not an approved mapping or an implementation of taxonomy todo #71. The research taxonomy in `docs/research/RIDE_TYPE_TAXONOMY.md` §2 orders categories approximately within platforms; its A/B/C *confidence grades* are evidence ratings, **not ride tiers**. The missing machine-readable catalog and provider-specific eligibility work remain unresolved.

Proposed display order for the ride categories in §2 (not pricing buckets):

| Proposed letter | Research canonical name | Neutral display name |
|---|---|---|
| A | `economy_shared` | Shared ride |
| B | `economy_flex` | Flexible pickup |
| C | `economy_standard` | Standard ride |
| D | `economy_priority` | Priority pickup |
| E | `comfort` | Comfort ride |
| F | `comfort_ev` | Electric comfort ride |
| G | `eco` | Low-emission ride |
| H | `xl` | XL ride |
| I | `xl_cargo` | XL cargo ride |
| J | `premium_sedan` | Premium sedan |
| K | `premium_suv` | Premium SUV |
| L | `premium_hourly` | Premium hourly |
| M | `accessible_wav` | Wheelchair-accessible ride |
| N | `assisted` | Assisted ride |
| O | `senior_select` | Senior-select ride |
| P | `intercity` | Intercity ride |

Delivery (`delivery_food`, `delivery_retail`, `delivery_package`) and `UNKNOWN` should remain distinct, not forced into the ride letters without a separate product decision. The research §2 order is **not** a cross-platform revenue or eligibility ranking, and `reserve` / `scheduled` are modifiers. Melody must confirm whether the list, order, names, and handling of delivery and unknown are correct before letters appear in the UI.

The current saved analyzer rules have `standard`, `premium`, and optional `comfort` / `xl` rate buckets. They do not have a one-to-one mapping to the research categories above: for example a generic `standard` fallback also handles products without dedicated rate buckets. The current UI can use neutral descriptive bucket names, but **must not** label those buckets A–D. Do not change persisted rule keys, thresholds, recognition of operator text in captures, decision economics, or provider eligibility just to adopt display labels.