# MotionHive Romanian gym glossary

Decides how every gym word in the exercise library is said in Romanian before anyone translates a name. Full data, with notes and sources per term, is in `glossary.json` (276 terms, 17 muscles, 15 equipment types, 12 grammar rules, 40 examples).

Taste rule taken from the owner's locked picks: classic lifts in Romanian, newer or brand-like names in English, and always the word a Romanian coach says to a client, not the dictionary word.

## The big calls

| Question | Decision | Why |
|---|---|---|
| Barbell: haltera or bara | **bara** ("cu bara") | World Class, Decathlon and Myprotein's own workouts write "Împins la piept cu bara", "Ramat cu bara". Haltera is the weightlifting word for the loaded apparatus. Unqualified "bara" always means the barbell; other bars are always qualified (bara EZ, bara T, bara hexagonală, bară de tracțiuni). |
| Cable: scripete, cablu or helcometru | **la scripete**; **helcometru only for pulldowns** | World Class chest and Decathlon arms write "la scripete". "Tracțiuni la helcometru" is the most consistent machine name across World Class, Stay Fit, Myprotein and Spotmedia. "Cablu" is fine in speech but reads as an anglicism in a title. |
| Press | **Împins** everywhere; **Presă** only in Presă militară, Presă Arnold, Presă Bradford, Presă pentru picioare | Matches the locked Împins la piept and the UI's Împingere labels; the four Presă names are fixed in Romanian gyms (no source writes "împins militar"). |
| Olympic lifts | **Smuls** (snatch), **Aruncat** (clean and jerk); clean, jerk, push press, thruster, snatch balance stay **English** | Smuls and aruncat are the federation and Olympic Committee terms and appear in sports news. "Pus la piept" is weightlifting club jargon. Fitwill's Romanian calls the clean "smuls": that is wrong, never copy it. |
| Stretches | **Întinderea + genitive**, then position | World Class headings: "Întinderea cvadricepsului", "Întinderea umerilor". Foam roller (-SMR) entries become "Masaj cu rola pentru ...". |
| Plural rule | Rep movements plural (Genuflexiuni, Fandări, Flotări, Tracțiuni, Flexii, Ridicări, Abdomene); supine nouns invariable (Împins, Ramat, Smuls, Aruncat); holds and stretches singular | How gyms say them. UI pattern labels (Genuflexiune, Fandare) stay singular because they name categories. |
| Crunch vs sit-up | **Abdomene** vs **Ridicări de trunchi** | Two different exercises need two names; ridicări de trunchi is the school PE wording. |
| EZ bar | **bara EZ** | Mitrache, Myprotein, World Class triceps. Retail says "bara Z" (alternative). |
| One-arm / single-leg | **cu o mână** / **pe un picior** | Most natural spoken forms; push-ups and chin-ups use "pe o mână". |

## Muscles

| slug | Romanian | alternatives | note |
|---|---|---|---|
| abdominals | **Abdomen** | Abdominali | What a coach says for the group ("azi facem abdomen"); keeps it apart from the exercise word "Abdomene". World Class uses "mușchii abdominali" for the muscles themselves. |
| abductors | **Abductori** |  |  |
| adductors | **Adductori** |  | Groin stretches target these: "Întinderea adductorilor". |
| biceps | **Biceps** | Bicepși (plural) | Singular label, as gyms say "facem biceps". |
| calves | **Gambe** |  |  |
| chest | **Piept** | Pectorali | Matches the locked "Împins la piept". |
| forearms | **Antebrațe** |  |  |
| glutes | **Fesieri** |  |  |
| hamstrings | **Femurali** | Ischiogambieri | LOCKED by owner. |
| lats | **Dorsali** | Marele dorsal | LOCKED by owner. |
| lower_back | **Lombari** | Zona lombară | Gym word, parallel to Dorsali and Femurali ("aparat de lombari", "lombarii"). |
| middle_back | **Mijlocul spatelui** | Romboizi, Spatele mijlociu (World Class) | unverified, my judgment for the exact phrase; World Class writes "spatelui mijlociu și superior" and lists romboizi. |
| neck | **Gât** |  |  |
| quadriceps | **Cvadricepși** | Cvadriceps | Plural like Fesieri and Femurali (World Class "cvadricepșii"). Singular genitive in stretch names: "Întinderea cvadricepsului". |
| shoulders | **Umeri** | Deltoizi |  |
| traps | **Trapez** |  | Singular, as gyms say it. |
| triceps | **Triceps** | Tricepși (plural) |  |

## Equipment

| slug | Romanian | note |
|---|---|---|
| bands | **Benzi elastice** | Decathlon category name. |
| barbell | **Bară** | Gym word. Alternative "Haltera". Unqualified "Bară" in the filter list means the barbell; the others are "Bară EZ" and "Bară de tracțiuni". |
| bench | **Bancă** |  |
| bodyweight | **Greutatea corpului** | Already used by the UI (exerciseKind BODYWEIGHT). |
| cable | **Scripete** | Alternatives: Cablu, Helcometru. See terms. |
| dumbbell | **Gantere** | Plural label, since most exercises use a pair. |
| exercise_ball | **Minge de fitness** | Alternatives: Minge suedeză, Fitball. |
| ez_bar | **Bară EZ** | Alternative "Bară Z" (retail). |
| foam_roller | **Rolă de masaj** | Alternative "Foam roller". |
| kettlebell | **Kettlebell** |  |
| machine | **Aparat** |  |
| medicine_ball | **Minge medicinală** | unverified, my judgment for the source; standard product name. |
| other | **Altele** |  |
| pull_up_bar | **Bară de tracțiuni** |  |
| smith_machine | **Aparat Smith** |  |

## Core vocabulary

The movement words a translator meets most. Everything else is in `glossary.json`.

| English | Romanian | |
|---|---|---|
| Squat | **Genuflexiuni** |  |
| Deadlift | **Îndreptări** |  |
| Bench press | **Împins la piept** |  |
| Romanian deadlift | **Îndreptări românești** |  |
| Stiff-legged deadlift / stiff leg | **Îndreptări cu picioarele întinse** |  |
| Lunge | **Fandări** |  |
| Walking lunge | **Fandări din mers** |  |
| Split squat | **Fandări statice** |  |
| Bulgarian split squat (rear foot elevated) | **Fandări bulgărești** |  |
| Step-up | **Urcări pe bancă** |  |
| Glute bridge / bridge / butt lift / hip bridge | **Pod pentru fesieri** |  |
| Leg press | **Presă pentru picioare** |  |
| Leg extension | **Extensii pentru cvadriceps** |  |
| Leg curl | **Flexii pentru femurali** |  |
| Calf raise | **Ridicări pe vârfuri** |  |
| Hyperextension / back extension | **Hiperextensii** |  |
| Good morning | **Good morning** | English kept |
| Press (generic) | **Împins** |  |
| Shoulder press / overhead press | **Împins deasupra capului** |  |
| Military press | **Presă militară** |  |
| Push-up | **Flotări** |  |
| Dip (parallel bars) | **Flotări la paralele** |  |
| Bench dip | **Flotări inverse la bancă** |  |
| Fly / flye | **Fluturări** |  |
| Reverse fly / back flyes / rear delt fly | **Fluturări inverse** |  |
| Cable crossover | **Crossover la scripete** | hybrid |
| Pullover | **Pullover** | English kept |
| Triceps extension | **Extensii pentru triceps** |  |
| Pushdown | **Extensii pentru triceps la scripete** |  |
| Skull crusher | **Skull crusher** | English kept |
| Lateral raise / side laterals | **Ridicări laterale** |  |
| Front raise | **Ridicări frontale** |  |
| Upright row | **Ramat vertical** |  |
| Shrug | **Ridicări de umeri** |  |
| Row | **Ramat** |  |
| Seated cable row | **Ramat la scripete din șezut** |  |
| Inverted row / bodyweight row | **Tracțiuni australiene** |  |
| Pull-up | **Tracțiuni** |  |
| Chin-up / chins | **Tracțiuni cu priză supinată** |  |
| Lat pulldown / pulldown | **Tracțiuni la helcometru** |  |
| Straight-arm pulldown | **Pullover la scripete cu brațele întinse** | hybrid |
| Curl | **Flexii** |  |
| Hammer curl | **Flexii ciocan** |  |
| Preacher curl | **Flexii la banca Scott** |  |
| Concentration curl | **Flexii concentrate** |  |
| Wrist curl | **Flexii de încheietură** |  |
| Crunch | **Abdomene** |  |
| Sit-up | **Ridicări de trunchi** |  |
| Reverse crunch | **Abdomene inverse** |  |
| Leg raise | **Ridicări de picioare** |  |
| Russian twist | **Russian twist** | English kept |
| Side bend | **Îndoiri laterale** |  |
| Side bridge / side plank | **Plank lateral** | hybrid |
| Snatch | **Smuls** |  |
| Clean and jerk | **Aruncat** |  |
| Clean | **Clean** | English kept |
| Jerk | **Jerk** | English kept |
| Kettlebell swing | **Swing cu kettlebell** | hybrid |
| Turkish get-up | **Turkish get-up** | English kept |
| Farmer's walk | **Farmer's walk** | English kept |
| Sled push / drag / row | **Împins sania / Tras sania / Ramat cu sania** |  |
| Box jump | **Sărituri pe cutie** |  |
| Stretch | **Întinderea + genitive** |  |
| SMR (self-myofascial release, foam roller) | **Masaj cu rola pentru ...** |  |
| Circles | **Rotiri** |  |

## Positions, grips, sides

| English | Romanian |
|---|---|
| Standing | din picioare |
| Seated | din șezut |
| Lying | din culcat |
| Prone / lying face down | culcat pe burtă |
| Supine / lying face up | culcat pe spate |
| Side-lying / on your side | culcat pe o parte |
| Kneeling / half kneeling | din genunchi / din semi-genunchi |
| Bent over | din aplecat |
| Incline (bench) | înclinat / pe banca înclinată |
| Decline (bench) | declinat / pe banca declinată |
| Flat (bench) | pe banca plană |
| Hanging | din atârnat |
| Overhead / above head | deasupra capului |
| Behind the neck / behind the back | la ceafă / la spate |
| Elevated | ridicat / de pe treaptă |
| Against a wall / on a chair | la perete / pe scaun |
| Partials | parțiale |
| Grip | priză |
| Close grip / narrow | priză îngustă |
| Wide grip | priză largă |
| Medium grip | priză medie |
| Reverse / underhand / supinated grip | priză supinată |
| Overhand / pronated grip | priză pronată |
| Neutral / palms in / hammer grip | priză neutră / palmele față în față |
| Palms up / palms down | palmele în sus / palmele în jos |
| Mixed grip / open palm | priză mixtă / cu palma deschisă |
| Stance (narrow / wide) | cu picioarele apropiate / cu picioarele depărtate |
| One-arm / single-arm / one arm | cu o mână |
| Single-leg / one-legged / one leg | pe un picior |
| Alternating / alternate | alternativ (agrees: alternative) |
| Two-arm / double / two-dumbbell | cu ambele mâini / cu două kettlebell-uri / cu gantere |
| Iso (iso-lateral machine) | unilateral |

## Naming rules

**1. Word order.** Movement noun, then its fixed qualifier (target, style or proper name), then equipment or station, then position, then side (cu o mână, pe un picior, alternativ). A grip or attachment that the English put after a dash or in parentheses goes last, after a comma. Do not add equipment the English name does not mention, unless two dataset entries would otherwise get the same Romanian name.

* Seated Dumbbell Press → Împins deasupra capului cu gantere din șezut
* Bent Over Barbell Row → Ramat cu bara din aplecat
* Standing One-Arm Cable Curl → Flexii la scripete din picioare, cu o mână
* Barbell Bench Press, Medium Grip → Împins la piept cu bara, priză medie

**2. Grip placement.** Write "cu priză X" when no other "cu" phrase precedes it ("Tracțiuni la helcometru cu priză largă"). When the name already contains "cu <equipment>", write ", priză X" with no second "cu" ("Împins la piept cu bara, priză îngustă"). The same comma rule applies whenever two "cu" phrases would meet: "Îndreptări cu picioarele întinse, cu gantere".

* Wide-Grip Lat Pulldown → Tracțiuni la helcometru cu priză largă
* Close-Grip Barbell Bench Press → Împins la piept cu bara, priză îngustă

**3. Singular vs plural movement noun.** Rep movements take the plural gyms use: Genuflexiuni, Îndreptări, Fandări, Flotări, Tracțiuni, Flexii, Extensii, Ridicări, Fluturări, Abdomene, Hiperextensii, Urcări, Sărituri, Rotiri, Abducții, Adducții, Treceri. Supine nouns stay singular and never pluralise: Împins, Ramat, Smuls, Aruncat, Tras, Mers, Vâslit. Holds, stretches and single efforts are singular: Plank, Pod pentru fesieri, Întinderea X, Masaj cu rola, Poziția copilului, Aruncare, Săritură în lungime. English loans keep the English number: Hip thrust, Good morning, Pullover, Kickback, Crossover, Swing, Clean, Jerk, Face pull. The UI movement pattern labels (Genuflexiune, Fandare) stay singular because they name categories.

* Dumbbell Lunges → Fandări cu gantere
* Upright Barbell Row → Ramat vertical cu bara
* Single Leg Glute Bridge → Pod pentru fesieri pe un picior

**4. Equipment phrase.** Free weights take "cu": definite article for one implement (cu bara, cu gantera, cu bara EZ, cu discul, cu mingea medicinală, cu banda elastică, cu sania), indefinite plural for a pair or set (cu gantere, cu benzi elastice, cu lanțuri, cu două kettlebell-uri). Kettlebell stays bare: cu kettlebell. Stations take "la": la scripete, la helcometru, la aparat, la aparatul Smith, la aparatul cu pârghie, la presa pentru picioare, la banca Scott, la paralele, la bară, la inele, la TRX, la landmine, la perete. Surfaces take "pe": pe bancă, pe banca înclinată, pe banca declinată, pe banca plană, pe mingea de fitness, pe cutie, pe Bosu. Bara without a qualifier always means the barbell.

* Dumbbell Shrug → Ridicări de umeri cu gantere
* One-Arm Dumbbell Row → Ramat cu gantera, cu o mână
* Smith Machine Squat → Genuflexiuni la aparatul Smith
* Ball Leg Curl → Flexii pentru femurali pe mingea de fitness

**5. One side.** One-arm = "cu o mână" (alternative "cu un braț"), placed at the end after a comma when equipment precedes it. Push-ups and chin-ups say "pe o mână". Single-leg = "pe un picior". Alternating = "alternativ", agreeing with plural nouns ("Flexii ciocan alternative"). "cu ambele mâini" only when a one-arm twin exists in the dataset.

* One-Arm Kettlebell Swings → Swing cu kettlebell, cu o mână
* Single-Arm Push-Up → Flotări pe o mână
* Kettlebell One-Legged Deadlift → Îndreptări cu kettlebell pe un picior

**6. Stretch names.** "Întinderea" + the muscle in the genitive, as World Class titles them, then position. Fixed genitives: cvadricepsului, femuralilor, gambei (one leg) or gambelor (both), fesierilor, adductorilor, abductorilor, flexorilor șoldului, dorsalilor, pieptului, umerilor, umărului (one arm), bicepsului, tricepsului, antebrațului, gâtului, zonei lombare, spatelui, mijlocului spatelui, bandeletei iliotibiale, tendonului lui Ahile, solearului, peronierilor, tibialului posterior. MOBILITY entries named only by a muscle ("Seated Glute", "Overhead Lat", "Kneeling Hip Flexor") are stretches and take the same pattern. Named poses keep their Romanian pose name (Poziția copilului, Pisica). Foam roller entries ("-SMR") become "Masaj cu rola pentru" + muscle, nominative.

* Quad Stretch → Întinderea cvadricepsului
* Seated Glute → Întinderea fesierilor din șezut
* Standing Hamstring and Calf Stretch → Întinderea femuralilor și a gambei, din picioare
* Rhomboids-SMR → Masaj cu rola pentru romboizi

**7. Sentence case.** Capitalise only the first word, proper names (Arnold, Zottman, Smith, Scott, Zercher, Atlas, Pallof, Ahile, Bosu) and acronyms (EZ, TRX, T, JM). English hybrid tails are lowercase mid-name: "Swing cu kettlebell", "Presă Arnold", "Pod pentru fesieri", "Muscle-up cu kipping". Never Title Case.

* Close-Grip EZ Bar Curl → Flexii cu bara EZ, priză îngustă
* Barbell Hip Thrust → Hip thrust cu bara

**8. No dashes.** No em dash, no en dash, no spaced hyphen anywhere. A separator in the English name (a dash in the original dataset) becomes ", " + the suffix. English parentheses are kept only when they add an alias or option ("(sau peste garduri)"); otherwise fold them into the name with a comma. Hyphens inside words stay: muscle-up, kettlebell-uri, semi-genunchi, Turkish get-up. "-SMR" suffixes disappear (see stretch rule). Use Romanian quotes „ ” if a name ever needs quoting, decimal comma in numbers.

* Barbell Ab Rollout, On Knees → Rollout cu bara, din genunchi
* Hang Snatch, Below Knees → Smuls din atârnat, de sub genunchi
* Front Squat (Clean Grip) → Genuflexiuni frontale, priză de clean

**9. Press, presă or împins.** Every arm press is "Împins" (matches the locked Împins la piept). "Presă" appears only in fixed names Romanian gyms already use: Presă militară, Presă Arnold, Presă Bradford, and the machine Presă pentru picioare. Niche named presses stay fully English: JM press, Tate press, Svend press, Pallof press, Cuban press, Push press.

* Standing Military Press → Presă militară din picioare
* Dumbbell Floor Press → Împins de la sol cu gantere
* Seated Barbell Military Press → Presă militară cu bara din șezut

**10. Proper names and nationalities.** Person names stay as written, capitalised, after the Romanian noun (Flexii Zottman, Genuflexiuni Zercher, Presă Bradford). Translate the nationality only where gyms already do: românești, bulgărești. Brand-like coinages stay whole in English: Turkish get-up, Russian twist, Cuban press, World's greatest stretch, London bridges, Pirate ships, Spell caster.

* Zottman Preacher Curl → Flexii Zottman la banca Scott
* Kettlebell Pirate Ships → Pirate ships cu kettlebell

**11. Descriptive English names.** When the English name is a description rather than a name, translate the meaning the way a coach would explain it, keep it short, and start with the movement. Use "Exercițiu" as the head noun only when no movement word fits.

* Isometric Neck Exercise, Front And Back → Exercițiu izometric pentru gât, față și spate
* Lying Face Up Plate Neck Resistance → Rezistență pentru gât cu discul, culcat pe spate
* Looking At Ceiling → Întinderea cvadricepsului, cu privirea în tavan

**12. No duplicate names.** The dataset contains near duplicates (Pull-up / Pullups, Dumbbell Curl / Dumbbell Bicep Curl, Pushups / Push-ups variants). Each slug must get a distinct Romanian name: carry over whatever word distinguishes them in English ("Tracțiuni la bară" vs "Tracțiuni", "Flexii cu gantere" vs "Flexii pentru biceps cu gantere").

## 40 model translations

| English | Romanian | family |
|---|---|---|
| Barbell Bench Press, Medium Grip | Împins la piept cu bara, priză medie | press |
| Wide-Grip Decline Barbell Bench Press | Împins declinat cu bara, priză largă | press |
| Hammer Grip Incline DB Bench Press | Împins înclinat cu gantere, priză neutră | press |
| Arnold Dumbbell Press | Presă Arnold cu gantere | press |
| Smith Machine Overhead Shoulder Press | Împins deasupra capului la aparatul Smith | machine |
| Romanian Deadlift from Deficit | Îndreptări românești din deficit | hinge |
| Stiff-Legged Dumbbell Deadlift | Îndreptări cu picioarele întinse, cu gantere | hinge |
| Trap Bar Deadlift | Îndreptări cu bara hexagonală | hinge |
| Sumo Deadlift with Chains | Îndreptări sumo cu lanțuri | powerlifting |
| Front Squat (Clean Grip) | Genuflexiuni frontale, priză de clean | squat |
| Goblet Squat | Genuflexiuni goblet | squat |
| Split Squat with Dumbbells | Fandări statice cu gantere | lunge |
| Barbell Walking Lunge | Fandări din mers cu bara | lunge |
| Barbell Hip Thrust | Hip thrust cu bara | glutes |
| Bent Over Two-Dumbbell Row With Palms In | Ramat cu gantere din aplecat, palmele față în față | row |
| Seated Cable Rows | Ramat la scripete din șezut | cable |
| Underhand Cable Pulldowns | Tracțiuni la helcometru cu priză supinată | cable |
| Rope Straight-Arm Pulldown | Pullover la scripete cu brațele întinse, cu funie | cable |
| Triceps Pushdown, V-Bar Attachment | Extensii pentru triceps la scripete, cu mâner V | cable |
| Inverted Row | Tracțiuni australiene | bodyweight |
| Dips, Triceps Version | Flotări la paralele pentru triceps | bodyweight |
| EZ-Bar Skullcrusher | Skull crusher cu bara EZ | arms |
| Cross Body Hammer Curl | Flexii ciocan prin fața corpului | arms |
| Seated Palms-Down Barbell Wrist Curl | Flexii de încheietură cu bara din șezut, palmele în jos | arms |
| Bent Over Dumbbell Rear Delt Raise With Head On Bench | Ridicări laterale din aplecat cu gantere, cu fruntea pe bancă | shoulders |
| Leverage Shoulder Press | Împins deasupra capului la aparatul cu pârghie | machine |
| Hanging Leg Raise | Ridicări de picioare din atârnat | core |
| Kneeling Cable Crunch With Alternating Oblique Twists | Abdomene la scripete din genunchi, cu răsuciri alternative | core |
| Power Snatch from Blocks | Smuls în forță de pe blocuri | olympic |
| Hang Clean, Below the Knees | Hang clean de sub genunchi | olympic |
| Clean and Jerk | Aruncat | olympic |
| Snatch Pull | Tracțiune pentru smuls | olympic |
| One-Arm Kettlebell Swings | Swing cu kettlebell, cu o mână | kettlebell |
| Kettlebell Turkish Get-Up (Squat style) | Turkish get-up cu kettlebell, varianta cu genuflexiune | kettlebell |
| Sled Drag, Harness | Tras sania cu ham | strongman |
| Atlas Stones | Pietre Atlas | strongman |
| Band Pull Apart | Pull-apart cu banda elastică | bands |
| Box Jump (Multiple Response) | Sărituri pe cutie, în serie | plyometrics |
| Standing Hamstring and Calf Stretch | Întinderea femuralilor și a gambei, din picioare | stretch |
| Iliotibial Tract-SMR | Masaj cu rola pentru bandeleta iliotibială | foam roller |

## Routine and cue words

| English | Romanian | status |
|---|---|---|
| Push day | Zi de împins | locked |
| Leg day | Zi de picioare | locked |
| Pull day | Zi de tras | proposal, unverified, my judgment |
| Upper body / Lower body | Partea superioară / Partea inferioară | proposal |
| Full body | Full body | proposal |
| hinge (cue) | flexie din șold | UI term |
| brace (cue) | contractă abdomenul | proposal |
| reps per leg (cue) | repetări pe fiecare picior | proposal |
| to failure (cue) | până la epuizare | UI term |

## Open questions for the owner

* Olympic lifts: hybrid (Smuls / Aruncat in Romanian, Clean / Jerk / Push press in English) or full Romanian weightlifting vocabulary (pus la piept, aruncare de la piept)? Gym chains write neither form consistently.
* Kettlebell swing: "Swing cu kettlebell" (World Class keeps the English) or "Balansări cu kettlebell" (Myprotein)?
* Russian twist: English, "Twist rusesc" (GymBeam) or "Rotații rusești" (World Class)?
* Skull crusher kept in English (World Class) vs "extensii franceze" (not found in any fetched source).
* Bara EZ vs bara Z vs bara W: written sources split EZ/Z; W is unverified.
* Athletics drills (pas sărit for bound, pas săltat for skip, pendularea gambelor for butt kick): my judgment, not verified against an FRA source.
* Middle back label: "Mijlocul spatelui" (my pick) vs "Romboizi" vs "Spatele mijlociu".
* Pull day: "Zi de tras" proposal needs the owner's ear.
* Strongman event names left in English; the owner may want Romanian for tire flip and sled work.

## Warnings

* Fitwill's Romanian library (fitwill.app/ro) is useful for phrasing patterns but is machine-assisted: it calls the clean "smuls" and the clean and jerk "Smuls și aruncat". Never copy its Olympic lift names.
* Romanian fitness media is split: Stay Fit Gym and BZI write whole programs in English (bench press, leg press, lat pulldown). This glossary follows the owner's rule: classic lifts in Romanian, newer or brand-like names in English.
* UI placeholder "Genuflexiune goblet cu tempo" (beeactive-ui projects/web and projects/mobile ro.json) uses the singular; the exercise naming rule is plural.

## Sources

Pages marked *fetched* were read in full during research; *search* means the title or snippet was seen in search results (Fitwill returned 403 to direct fetches, so its exercise titles are cited from search results). Anything without a source is marked "unverified, my judgment" in the JSON.

* *fetched* https://www.worldclass.ro/revista/exercitii-cu-gantere-exercitii-spate-triceps-umeri-piept-cu-gantere: Flexii biceps cu gantere, Împins cu gantere pe bancă, Fluturări cu gantere, Pullover cu gantera, Ramatul cu gantera, Ramatul cu o mână, Ridicări laterale, Ridicările pe vârfuri, Fandările înainte și înapoi; keeps Hammer curls, Reverse fly, Arnold press in English
* *fetched* https://www.worldclass.ro/revista/tractiuni-la-bara-beneficii-biceps-piept-coloana-spate: tracțiuni la bară, priză pronată, priză supinată, priză neutră, tracțiuni asistate, tracțiuni cu priză largă/îngustă, tracțiuni ponderate, ramatul cu bara, tracțiuni la helcometru, muscle-up
* *fetched* https://www.worldclass.ro/revista/exercitii-umeri-ghid-pentru-antrenamentul-umerilor: Presa militară, Presa Arnold, Ridicări laterale cu gantere, Ridicări frontale cu gantere/disc/kettlebell, Fluturări reverse, Ramatul vertical cu haltera / bara Z; deltoizi, umeri, trapez
* *fetched* https://www.worldclass.ro/revista/exercitii-pentru-picioare-care-sunt-cele-mai-bune-exercitii-pentru-picioare: Genuflexiuni, Fandări, Îndreptări românești, Urcări pe scaun/scări, Fandări bulgărești, Genuflexiuni sumo, podul pentru fesieri (glute bridge), pistol squats; cvadricepși, ischiogambieri, fesieri, gambe, mușchii femurali
* *fetched* https://www.worldclass.ro/revista/exercitii-piept-recomandari-de-antrenamente-pentru-piept-la-sala: Împins din culcat cu bara, Împins înclinat cu bara, Împins declinat, Fluturări cu gantere, Pullover cu gantera, Fluturări la scripete, Pec-deck, Flotări la paralele; bancă plană/înclinată/declinată
* *fetched* https://www.worldclass.ro/revista/exercitii-triceps-la-sala-si-acasa/: Dips la paralele, Flotări diamant, Extensii triceps deasupra capului, Kickback cu ganteră, Extensii pentru triceps din culcat; keeps Skull crushers, Triceps pushdown, Close grip bench press in English; uses cablu, scripete, helcometru, bară EZ
* *fetched* https://www.worldclass.ro/revista/cum-sa-te-intinzi-corect-ghid-pentru-o-flexibilitate-optima: Stretch headings in the pattern Întinderea + genitive: Întinderea cvadricepsului, Întinderea umerilor, Întinderea lombară
* *fetched* https://www.worldclass.ro/revista/glutes-exercitii-pentru-cresterea-fesierilor-fara-dezvoltarea-picioarelor/: Hip Thrust (English), Kickback la aparat sau cu bandă elastică, Abducții laterale la aparat, Podul gluteal sau podul fesierilor, Step-up pe bancă joasă; mușchii fesieri, mușchii lombari
* *fetched* https://www.worldclass.ro/revista/exercitii-cu-banda-elastica-pentru-picioare-abdomen-si-spate/: genuflexiuni cu bandă elastică, fandări laterale, podul de fesieri, abducțiile de șold, ramatul cu bandă, ridicări laterale cu bandă, abdomene cu bandă elastică, rotații rusești cu bandă
* *fetched* https://www.worldclass.ro/revista/pozitia-plank-ce-este-tipuri-si-beneficii/: Plank clasic, Plank lateral, Plank inversat, Plank pe antebrațe; always writes plank, never planșă
* *fetched* https://www.worldclass.ro/revista/exercitii-de-incalzire-inainte-de-antrenament-la-sala/: Jumping jacks, Rotiri de brațe, Rotiri de trunchi, Rotiri de umeri, Rotiri de gât, Rotiri de șolduri, Ridicări pe vârfuri, Ridicări de genunchi, Bird-dog, Sărituri cu coarda, Alergare pe loc
* *fetched* https://www.worldclass.ro/revista/exercitii-cardio-acasa-si-la-sala-beneficii/: jumping jacks, mountain climbers, burpees (English), sărituri cu coarda, jogging pe loc, ciclism
* *fetched* https://www.worldclass.ro/revista/grupe-musculare-picioare-spate-program-sala-pe-grupe-musculare/: piept (pectorali), spate, trapez, romboizi, umeri (deltoizi), antebrațe, cvadricepșii, mușchii femurali (ischiogambieri), mușchii fesieri, gambele, mușchii abdominali, oblicii, lombarii; împinsul la bancă, presa militară, flexii biceps, extensii pentru cvadricepși
* *fetched* https://www.worldclass.ro/revista/cum-sa-obtii-un-abdomen-tonifiat-cele-mai-eficiente-exercitii-la-aparate/: abdomen machine work; contractă abdomenul; mușchii abdominali inferiori
* *fetched* https://www.worldclass.ro/revista/exercitii-pentru-coapse/: Flexii pentru femurali la sol sau aparat, Fandări laterale, Sumo squat / Plie squat, Clamshell (cochilia), mingea de fitness, role de spumă; cvadriceps, femurali, adductori și abductori
* *fetched* https://www.worldclass.ro/revista/exercitii-calistenice-ce-sunt-beneficii/: flotări la perete, flotări pe genunchi, flotări diamant, tracțiuni la bară, tracțiuni australiene, Dips la paralele, Pistol squat (genuflexiune pe un picior), Muscle-up, L-sit, Handstand
* *fetched* https://www.worldclass.ro/revista/tonifiere-brate-metode-si-exercitii: mostly English names (Hammer curl, Concentration curl, Tricep kickback, Shoulder press cu gantere): evidence that usage is split
* *fetched* https://stayfit.ro/6-12-25-ce-este/: Stay Fit Gym: Flotări, Fluturări cu gantere, Îndreptări, Ramat, Tracțiuni la helcometru, Genuflexiuni, Fandări bulgărești, Extensii la aparat
* *fetched* https://stayfit.ro/cum-sa-antrenezi-grupele-musculare-complementar-metoda-push-pull-legs/: Stay Fit Gym push/pull/legs article written almost entirely with English exercise names (bench press, military press, dips, rows, curls, squats, leg press)
* *fetched* https://sfaturi.decathlon.ro/bodybuilding-exercitii-de-baza: Decathlon: Tracțiuni, Îndreptări, Împins la piept cu bara, Flexii cu bara dreaptă, Împins la piept cu priză îngustă, Genuflexiuni; uses bara, not haltera
* *fetched* https://sfaturi.decathlon.ro/exercitii-de-antrenare-a-bratelor-pentru-barbati: Decathlon: Flexiile concentrate, Flexiile cu bară, Flexia cu haltera, Extensii triceps la scripete cu funia, Extensia antebrațelor la helcometru, Extensii triceps cu un braț cu gantera, Împinsul cu priză îngustă, Flotările la paralele, Flexiile ciocan prin fața corpului, Flotările diamant
* *fetched* https://sfaturi.decathlon.ro/8-exercitii-cu-gantere-rutina-mea-de-fitness: Decathlon: ridicări laterale, extensii pentru triceps, ramat cu gantere (cu o mână), ridicarea umerilor, ridicări frontale cu gantere; din șezut, în picioare, culcat
* *fetched* https://sfaturi.decathlon.ro/exercitii-pentru-gambe-si-glezne-stretching-si-alte-antrenamente-de-incalzire: Decathlon: Rotiri de gleznă, Întinderea tendonului lui Ahile, Ridicări pe vârfuri din șezut
* *fetched* https://sfaturi.decathlon.ro/exercitii-cardio-pentru-acasa: Decathlon: Alergatul pe loc, Săriturile cu coarda, Genuflexiunile cu săritură (jump squats), Urcările pe stepper, Burpees, rotiri de brațe
* *fetched* https://gymbeam.ro/blog/21-cele-mai-bune-exercitii-pentru-abdomen/: GymBeam: Ridicări scurte (abdomene), Ridicări scurte reverse, Plank lateral, Twist rusesc, Plank, Bicicleta, Foarfece, Abdomene în V, Superman
* *fetched* https://gymbeam.ro/blog/cum-sa-construiti-masa-musculara-ghid-despre-antrenament-nutritie-si-recuperare-alaturi-de-marius-mitrache/: Marius Mitrache (Romanian IFBB pro): pull-over la cablu pentru spate, ridicări laterale cu gantere, hiperextensii, împins înclinat cu gantere, extensii deasupra capului cu spatele la cablu, flexii cu bara EZ, extensii la aparatul pentru cvadricepși, flexii din șezut pentru femurali, ridicări pe vârfuri pentru gambe; trapez, gambe, femurali
* *fetched* https://www.myprotein.ro/blog/antrenament/antrenamente-cu-haltera-16-exercitii-cu-haltera-pentru-a-creste-forta-si-a-te-pastra-tonifiat/: Myprotein: Ramat cu haltera din aplecat, Îndreptări, Îndreptări românești, Flexii concentrate cu haltera, Flexii de încheietură cu palmele în sus, Extensii pentru triceps cu bara EZ deasupra capului, Împins la piept, Împins la piept la bancă înclinată, Ridicări de bazin cu haltera, Genuflexiuni bulgărești, Îndreptări cu picioarele drepte, Fandări cu haltera; priză supinată, priză pronată
* *fetched* https://www.myprotein.ro/blog/antrenament/cele-mai-bune-15-exercitii-pentru-abdomen-pentru-acasa-sau-sala/: Myprotein: Abdomene, Abdomene reverse, Ridicări de picioare, many English names (Ab Roller, Hollow Holds, Bicycle Crunch)
* *fetched* https://www.myprotein.ro/blog/antrenament/extensiile-pentru-cvadriceps-tehnica-de-executie-beneficii/: Myprotein: Extensiile pentru cvadriceps, aparatul de extensii, Fandările bulgărești
* *fetched* https://www.myprotein.ro/blog/antrenament/creste-in-masa-musculara-cu-acest-antrenament-pentru-piept-si-spate/: Myprotein: Împins la piept la bancă, Ramat cu bara din picioare aplecat, Ramat cu gantere la bancă, Pullover cu gantera, Împins la piept cu gantere în plan înclinat, Fluturări înclinate cu ganterele; bancă dreaptă, bancă înclinată
* *fetched* https://www.myprotein.ro/blog/antrenament/antrenament-pentru-incepatori-piept-umeri-si-triceps/: Myprotein: Împins din culcat cu bara dreaptă, Împins cu bara deasupra capului, Fluturări la cabluri, Extensii pentru triceps deasupra capului
* *fetched* https://www.myprotein.ro/blog/antrenament/incearca-acest-antrenament-pentru-tonifierea-partii-inferioare-a-corpului/: Myprotein: Flexii ale bicepsului femural (cu minge suedeză), Genuflexiuni cu ganterele, Fandări cu gantere, Îndreptări românești cu kettlebell, Balansări cu kettlebell; partea inferioară a corpului
* *fetched* https://www.myprotein.ro/blog/antrenament/4-exercitii-eficiente-pentru-spate/: Myprotein: Tracțiuni la bară, Helcometru cu priză largă, Extensii pentru mușchii lombari, Ramat cu o ganteră
* *fetched* https://www.myprotein.ro/blog/antrenament/cum-se-executa-corect-presa-pentru-umeri-deasupra-capului-2/: Myprotein: Presa pentru umeri, presa deasupra capului, ramatul vertical; bara, gantere
* *fetched* https://www.cosr.ro/news/mihaela-cambei-tripla-campioana-europeana-de-seniori-la-haltere: Romanian Olympic Committee: 92 kg la stilul smuls și 106 kg la stilul aruncat (smuls = snatch, aruncat = clean and jerk)
* *fetched* https://ro.wikipedia.org/wiki/Haltere: smuls and aruncat as the two styles; împins removed; haltera = the whole apparatus, bara = the bar, discuri = plates
* *fetched* https://housefit.ro/ridicarile-olimpice-antrenament-cu-greutati/: smulsul, aruncatul, aruncatul în forță, pusul la piept (prima fază a aruncatului), aruncatul din atârnat
* *fetched* https://www.steroizi.ro/metode-de-antrenament/ridicarile-olimpice/: smuls, aruncat, pusul la piept, aruncat în forță, aruncat din atârnat, smuls în forță
* *fetched* https://www.steroizi.ro/exercitii-olimpice/smuls/: Smuls, Smuls cu gantera, ramat în stil olimpic cu priza de smuls
* *fetched* https://weightlifting.ro/haltere: weightlifting club: smuls and aruncat; întoarcere for bringing the bar to the chest
* *fetched* https://spotmedia.ro/stiri/timp-liber/exercitii-esentiale-pentru-spate-cele-mai-eficiente-aparate-pentru-fiecare-zona: aparat de lombari, extensii la un aparat de lombari, ramat din șezut la aparatul helcometru, tracțiuni la helcometru; erectorii spinali, lombarii, romboizi, trapez, marele dorsal
* *fetched* https://www.sport.ro/promo/top-3-aparate-esentiale-pentru-dezvoltarea-musculaturii-picioarelor-p.html: Presa pentru picioare, aparatul pentru flexia picioarelor din șezut, aparatul pentru ridicări pe vârfuri din șezut; bicepși femurali, gambă
* *fetched* https://www.bzi.ro/program-de-sala-pentru-incepatori-antrenament-complet-pentru-intregul-corp-in-doar-30-de-minute-bodyline-5567424: beginner program written fully in English names (Leg Press, Lat Pulldown, Seated Row, Chest Press): evidence of split usage
* *search* https://www.worldclass.ro/revista/efectueaza-perfect-un-kettlebell-swing/: title: Efectuează perfect un kettlebell swing
* *search* https://www.worldclass.ro/revista/antrenament-functional-ce-este-ce-beneficii-are-si-cum-incepi/: functional training article listing Turkish Get-Up, Farmer's Walk, sleds (sanie), TRX
* *search* https://sfaturi.decathlon.ro/ce-aparat-de-fitness-cardio-este-potrivit-pentru-mine: banda de alergare, bicicleta eliptică, aparatul de vâslit
* *search* https://decathlon.ro/C-113086-aparate-fitness-cardio/N-660439-tip-produs~aparat-de-vaslit: category: aparat de vâslit
* *search* https://sfaturi.decathlon.ro/bicicleta-eliptica-tot-ce-trebuie-sa-stii-despre-acest-aparat-beneficii: title: Bicicleta eliptica: ghid complet
* *search* https://www.decathlon.ro/sanatate-si-nutritie/role-de-masaj?from=40&size=40: title: Rolă de Masaj (Foam Roller) pentru Spate și Picioare
* *search* https://www.decathlon.ro/toate-sporturile/fitness/benzi-elastice-fitness?from=120: category: Benzi elastice pentru fitness
* *search* https://www.decathlon.ro/toate-sporturile/fitness/bare-de-tranctiuni: category: bare de tracțiuni
* *search* https://www.decathlon.ro/p/mp/gorilla-sports/set-bare-de-helcometru-cu-maner-v-gorilla-sports/_/R-p-1d522eea-6309-45a6-bc31-a3f0268f738a: product: Set bare de helcometru cu mâner V
* *search* https://www.decathlon.ro/p/mp/vulkan-sport/maner-dublu-ramat-atasament-helcometru/_/R-p-b4d66673-27a9-4f98-a65a-fc3c805a3e57: product: Mâner dublu ramat, atașament helcometru (retail uses helcometru for the whole cable station)
* *search* https://www.decathlon.ro/p/mp/k-sport/bara-hexagonala-olimpica-go10/_/R-p-d5467134-7eb5-4385-b9c0-a92af36ee6cc: product: Bară Hexagonală Olimpică
* *search* https://www.decathlon.ro/p/mp/vulkan-sport/presa-de-picioare-verticala-incarcare-cu-discuri/_/R-p-bf924c02-5101-40fe-92e2-0feb6c2eff09: product: Presa de picioare verticală, încărcare cu discuri
* *search* https://www.decathlon.ro/p/mp/marbo-sport/banca-hiperextensii-ms-l108-2-0/_/R-p-f2a037e4-f2da-4d7b-afb1-ea0136453c20: product: Banca hiperextensii
* *search* https://www.decathlon.ro/toate-sporturile/bodybuilding-si-antrenament-culturism/echipament-pentru-abdomen: category: Aparat abdomene (banca și roata abdomene)
* *search* https://www.decathlon.ro/p/cutie-pliometrica-cross-training/_/R-p-342932: product: Cutie pliometrică
* *search* https://www.decathlon.ro/p/gantera-kettlebell-din-fonta-partial-reciclata-si-baza-din-cauciuc-6-kg/_/R-p-182833: product: Ganteră Kettlebell
* *search* https://www.decathlon.ro/toate-sporturile/cross-training/curele-si-inele-de-suspensie: category: Curele și inele de suspensie pentru antrenamente
* *search* https://www.decathlon.ro/p/set-gantere-si-bare-bodybuilding-93-kg-cu-discuri-din-fonta-partial-reciclata/_/R-p-10804: product: Set gantere și bare Bodybuilding cu discuri
* *search* https://www.decathlon.ro/p/mp/zipro/bara-z-zipro-120-cm-28-mm/_/R-p-9f05b84f-dd27-4258-ba9f-f3d9a0c3cefa: product: Bară Z
* *search* https://www.decathlon.ro/p/bara-bodybuilding-155cm-28-mm/_/R-p-9286?mc=8289896: product: Bară bodybuilding
* *search* https://www.emag.ro/bara-z-curbata-biceps-triceps-cu-sigurante-homefitr-bar-z/pd/D1JSVXMBM/: product: Bara Z curbată biceps triceps
* *search* https://www.emag.ro/set-de-haltere-100-kg-2-gantere-bara-de-haltere-bara-sz-30-31-mm-discuri-de-greutate-fonta-scsports-10002409/pd/D56CJJYBM/: product: Set de haltere, 2 gantere, bara de haltere, bara SZ, discuri
* *search* https://www.emag.ro/biciclete-fitness/filter/tip-bicicleta-f7833,orizontala-v-10614813/c: category: Biciclete fitness, tip bicicletă orizontală
* *search* https://gymbeam.ro/rola-de-exercitii-foam-roller-orange-gymbeam.html: product: Rolă de exerciții Foam Roller
* *search* https://gymbeam.ro/cutie-pliometrica-plyobox-wood-gymbeam.html: product: Cutie pliometrică PlyoBox
* *search* https://gymbeam.ro/bara-lifter-trap-gymbeam.html: product: Bară LIFTER Trap
* *search* https://evz.ro/aa-pasi-esentiali-de-urmat-pentru-antrenarea-musculaturii-abdominale.html: ridicări de trunchi din culcat dorsal (school PE abdominal test wording)
* *search* https://www.csid.ro/diet-sport/sport/5-motive-pentru-care-sa-incluzi-burpees-in-antrenamentul-tau-13453303: title: 5 motive pentru care să incluzi Burpees în antrenamentul tău
* *search* https://jhs.usch.md/wp-content/uploads/2022/05/SARITURI-CU-COARDA-SKIPPING-MIJLOC-EFICIENT-DE-DEZVOLTARE-A-CALITATILOR-MOTRICE-LA-ELEVII-DE-15-ANI.pdf: title: Sărituri cu coarda (skipping): in Romanian usage skipping can mean rope jumping
* *search* https://sfaturi.decathlon.ro/durerile-de-spate-cauze-cand-apar-exercitii-care-te-pot-ajuta-sa-scapi-de-durerea-de-spate: back pain article mentioning Face-Pull in English
* *search* https://fitwill.app/ro/exercise/2291/cable-wide-grip-lat-pulldown/: Tracțiuni La Helcometru Cu Priză Largă
* *search* https://fitwill.app/ro/exercise/2243/cable-pulldown/: Tracțiuni La Scripete
* *search* https://fitwill.app/ro/exercise/0201/cable-pushdown/: Extensii La Scripete
* *search* https://fitwill.app/ro/exercise/3047/cable-high-pulley-overhead-tricep-extension/: Extensii Pentru Triceps La Scripete Sus Deasupra Capului
* *search* https://fitwill.app/ro/exercise/1640/cable-rope-one-arm-hammer-preacher-curl/: Flexie La Banca Scott Cu Sfoară La Cablu, Cu O Singură Mână, Priză Neutră
* *search* https://fitwill.app/ro/exercise/5122/barbell-clean-and-jerk/: Smuls Și Aruncat Cu Haltera (WRONG: clean and jerk is aruncat alone; smuls is the snatch)
* *search* https://fitwill.app/ro/exercise/3183/barbell-hang-clean-below-the-knees-version-2/: Smuls Din Atârnat Cu Haltera De Sub Genunchi (WRONG: this is a hang clean, not a snatch)
* *search* https://fitwill.app/ro/exercise/0542/kettlebell-one-arm-snatch/: Smuls Cu Un Braț Cu Kettlebell
* *search* https://fitwill.app/ro/exercise/1524/barbell-heaving-snatch-balance/: Heaving Snatch Balance Cu Haltera (kept English)
* *search* https://fitwill.app/ro/exercise/1525/barbell-jerk-dip-squat/: Genuflexiune Cu Haltera Pentru Jerk (Jerk Dip Squat)
* *search* https://fitwill.app/ro/exercise/5705/barbell-clean-high-pull/: Ramat Înalt Cu Haltera (Clean High Pull)
* *search* https://fitwill.app/ro/exercise/0770/smith-squat/: Genuflexiuni La Aparatul Smith
* *search* https://fitwill.app/ro/exercise/1433/smith-front-squat-clean-grip/: Genuflexiuni Frontale La Aparatul Smith (priză Clean)
* *search* https://fitwill.app/ro/exercise/3311/barbell-front-squat-from-blocks/: Genuflexiuni Cu Haltera În Față De Pe Blocuri
* *search* https://fitwill.app/ro/exercise/1435/barbell-low-bar-squat/: Genuflexiuni Cu Haltera (bară Joasă)
* *search* https://fitwill.app/ro/exercise/0069/barbell-overhead-squat/: Genuflexiuni Cu Haltera Deasupra Capului
* *search* https://fitwill.app/ro/exercise/0127/barbell-zercher-squat/: Genuflexiuni Zercher Cu Haltera
* *search* https://fitwill.app/ro/exercise/0101/barbell-speed-squat/: Genuflexiuni Cu Haltera Pentru Viteză
* *search* https://fitwill.app/ro/exercise/2389/barbell-narrow-stance-squat/: Genuflexiuni Cu Haltera Cu Picioarele Apropiate
* *search* https://fitwill.app/ro/exercise/2670/smith-single-leg-split-squat/: Genuflexiuni Bulgărești La Aparatul Smith
* *search* https://fitwill.app/ro/exercise/1050/smith-calf-raise-with-block/: Ridicări Pe Vârfuri La Aparatul Smith Cu Bloc
* *search* https://fitwill.app/ro/exercise/3811/walking-lunge/: Fandări Din Mers
* *search* https://fitwill.app/ro/exercise/4000/static-lunge/: Fandare Statică
* *search* https://fitwill.app/ro/exercise/5921/dumbbell-hammer-preacher-curl/: Flexii Ciocan La Banca Scott Cu Gantere
* *search* https://fitwill.app/ro/exercise/2294/dumbbell-zottman-preacher-curl/: Flexii Zottman La Banca Scott Cu Gantere
* *search* https://fitwill.app/ro/exercise/2494/dumbbell-incline-hammer-curl/: Flexii Ciocan Pe Bancă Înclinată Cu Gantere
* *search* https://fitwill.app/ro/exercise/3032/barbell-standing-wide-military-press/: Presă Militară Cu Haltera Din Picioare, Priză Largă
* *search* https://fitwill.app/ro/exercise/1438/kettlebell-seated-two-arm-military-press/: Presă Militară Cu Două Kettlebell-uri Din Șezut
* *search* https://fitwill.app/ro/exercise/3101/lever-military-press-plate-loaded/: Presă Militară La Aparat Cu Pârghie (încărcare Cu Discuri)
* *search* https://fitwill.app/ro/exercise/4577/dumbbell-half-kneeling-military-press/: Presă Militară Cu Gantere Din Semi-genunchi
* *search* https://fitwill.app/ro/exercise/0772/smith-standing-behind-head-military-press/: Presă Militară La Aparat Smith Din Picioare, Cu Bara La Ceafă
* *search* https://fitwill.app/ro/exercise/0105/barbell-standing-bradford-press/: Presă Bradford Cu Haltera Din Picioare
* *search* https://fitwill.app/ro/exercise/2386/dumbbell-arnold-press/: Presă Arnold Cu Gantere
* *search* https://fitwill.app/ro/exercise/5074/landmine-press/: Împins La Landmine
* *search* https://fitwill.app/ro/exercise/5660/barbell-pin-chest-press/: Împins Cu Haltera De Pe Pini
* *search* https://fitwill.app/ro/exercise/0359/dumbbell-one-arm-reverse-fly-with-support/: Fluturări Inverse Cu Gantera, Cu Un Braț Și Sprijin
* *search* https://fitwill.app/ro/exercise/2392/dumbbell-rear-fly/: Fluturări Pentru Deltoidul Posterior Cu Gantere
* *search* https://fitwill.app/ro/exercise/5662/barbell-power-shrug/: Ridicări De Umeri Cu Haltera (Power Shrug)
* *search* https://fitwill.app/ro/exercise/3895/reverse-grip-pull-up/: Tracțiuni Cu Priză Inversă
* *search* https://fitwill.app/ro/exercise/1072/suspension-chest-dip/: Flotări La Paralele Cu Benzi De Suspensie
* *search* https://fitwill.app/ro/exercise/1749/ez-bar-standing-french-press/: Extensii Pentru Triceps Din Picioare Cu Bara EZ
* *search* https://fitwill.app/ro/exercise/0586/lever-lying-leg-curl/: Flexia Picioarelor La Aparat Din Culcat
* *search* https://fitwill.app/ro/exercise/3609/lever-kneeling-leg-curl-plate-loaded/: Flexie Picioare La Aparat Cu Pârghie Din Genunchi
* *search* https://fitwill.app/ro/exercise/3268/lying-leg-raise-to-side/: Ridicări De Picioare Din Culcat Lateral
* *search* https://fitwill.app/ro/exercise/4736/dumbbell-deep-push-up-and-renegade-row/: Flotări Adânci Cu Gantere Și Ramat Tip Renegade
* *search* https://fitwill.app/ro/exercise/0680/rope-climb/: Cățărarea Pe Frânghie
* *search* https://fitwill.app/ro/exercise/4558/child-to-cobra-pose/: Poziția Copilului În Cobra
* *search* https://fitwill.app/ro/exercise/4267/cobra-yoga-pose/: Poziția Cobra (Yoga)
