# NZ Labour Press Release Tone & Structure Guide

> Derived from close analysis of 20 NZ Labour Party press releases published via Scoop,
> 15 May – 17 July 2026 (source list at bottom). For use by the press statement
> generation feature: this is what "sounds like Labour" in this election cycle, and the
> rigour bar a draft must clear before it is usable.

## The three release types (pick one before drafting)

1. **Data-reactive attack** (most common, ~60% of corpus): a new statistic, report, or
   government admission drops → release fastens Government responsibility to it within
   hours. Examples: CPI/food-price data, Jobseeker numbers, Children's Monitor report,
   RBNZ OCR decision.
2. **Policy announcement**: Labour commits to something (Apprenticeship Boost expansion,
   scrapping fuel excise increase, repealing Disability Bill, ruling out rent rises).
   Positive framing first, contrast with National second, costed details in bullets at
   the end when applicable.
3. **Values/defence stand**: defending settled NZ ground National is disturbing
   (nuclear-free policy). Rarer; more elevated register; invokes national identity.

## Structural template (consistent across all 20)

1. **Headline**: short, declarative, Title Case, present tense. Attack headlines name
   the target ("Cost Of Living Still Rising Under Luxon", "Luxon Doesn't Know The Facts
   About Homeless"). Announcement headlines start with "Labour Will/To..." ("Labour Will
   Scrap Harmful Disability Bill").
2. **Un-attributed lede paragraph** (1–2 sentences): states the factual trigger or the
   commitment in plain declarative prose. No quote marks, no spokesperson yet. This is
   the "news" sentence a journalist can lift verbatim.
3. **First quote**: the strongest single framing line + spokesperson attribution with
   full portfolio title: `"...," Labour [portfolio] spokesperson [Name] said.`
4. **Quote body**: the entire remainder is one continuous quote from that spokesperson,
   broken into 1–2 sentence paragraphs, each opening with a quote mark. Rhythm:
   evidence → responsibility → human cost → (attack) demand/challenge OR
   (announcement) Labour's alternative.
5. **Close**: final paragraph re-attributes: `"..." [Name] said.` The closing line is
   either the Labour-plan pivot or a crisp challenge ("Show us the modelling, or admit
   this is a gamble with struggling families' money").
6. **Dual-quote variant**: announcements sometimes carry a second spokesperson (Leader
   sets frame, portfolio holder details policy — e.g. Hipkins then Halbert on
   apprenticeships; Hipkins then McAnulty on housing).
7. **Policy bullets**: announcement releases may end with "Key policy details:" bullets
   including cost and start dates ("Costed at an average of $56.5 million a year, funded
   through future operating allowances").

## Voice and register

- **Plain, spoken English.** Short declarative sentences. Contractions used freely
  ("isn't", "won't", "can't"). Written to be read aloud on camera.
- **Concrete over abstract.** Never "inflationary pressures" — always "white bread is up
  28 percent", "mash potatoes is getting harder to afford", "milk has gone up every
  month for two years". Groceries, mortgages, doctor's visits, filling the tank.
- **"Kiwis", "New Zealanders", "families", "whānau"** are the subjects of sentences.
  Harm is always done *to someone specific* ("truck drivers, farmers, and
  tradespeople").
- **Te reo Māori** used naturally where the subject warrants (tamariki, whānau, hauora,
  Te Puni Kōkiri) — routine vocabulary, not decoration.
- **Naming discipline**: "Christopher Luxon" (full name, high frequency — the target is
  personalised), "Nicola Willis", "National" as collective actor. Ministers named with
  portfolio when attacked ("Erica Stanford", "Tama Potaka"). Labour people get full
  title on first mention: "Labour finance and economy spokesperson Barbara Edmonds".
- **Controlled indignation, not rage.** Strongest adjectives in corpus: "disgraceful",
  "cruel", "humiliating", "chaotic", "out of touch". No profanity-adjacent language, no
  sarcasm beyond dry understatement ("You couldn't make this up" is about as far as it
  goes).

## Recurring frames (the 2026 message architecture)

These recur near-verbatim across releases — the generator should reach for them:

- **Broken promise**: "National promised to [fix the cost of living / reduce Jobseeker
  by 50,000 / bring mortgage rates down]. Instead, [opposite outcome]." The single most
  used device in the corpus.
- **Out of touch**: applied to Luxon/Willis personally, usually paired with a concrete
  detail they got wrong or ignored.
- **Choices frame**: "National chose cuts... Labour will make different choices." Budget
  releases especially. Government outcomes are framed as deliberate choices, never
  accidents.
- **Tax breaks contrast**: "handed tax breaks to tobacco companies and property
  speculators while [ordinary people suffered]" — appears verbatim in at least three
  releases; it's the standing fiscal-priorities contrast.
- **The Labour plan pivot** (attack releases end here): "Labour has a plan to make life
  more affordable, with three free doctor's visits, free prescriptions, a $20 public
  transport fare cap, and lower power bills through SolarSaver." The named, repeatable
  policy anchors in this cycle: **three free GP visits, free prescriptions, $20 public
  transport fare cap, SolarSaver, Apprenticeship Boost expansion, independent GP pricing
  authority, scrapping the fuel excise increase**.
- **Human scale conversion**: big numbers translated into lived scale ("218,000 on
  Jobseeker – about the population size of Wellington City"; "one in three households
  struggling to put food on the table").
- **Cost-of-living supremacy**: even non-economic stories (nuclear-free, homeschooling)
  loop back to "families are worried about paying the mortgage, affording groceries,
  and keeping their jobs".

## The rigour bar — what every draft must have, and what to check

This is the discipline visible in the corpus. Generated drafts must match it:

1. **A specific, checkable trigger.** Every release hangs on something that exists:
   a Stats NZ series, a named report (Sapere, Independent Children's Monitor), an RBNZ
   decision, a Hansard moment, a Government document. A release with no verifiable peg
   is not ready.
2. **Numbers are precise and sourced-in-reality**: "28 percent", "94.9 percent",
   "$23.6 million", "650,000 New Zealanders". Never round vaguely ("costs have soared
   dramatically") when a real figure exists — and NEVER invent a figure. If the user
   hasn't supplied a number, the draft must flag `[NUMBER NEEDED — verify]` rather than
   fabricate.
3. **Attribution must match the portfolio.** The quoted spokesperson must hold the
   relevant portfolio (check `knowledge/roles.json`). Finance/economy data → Edmonds.
   Health → Verrall. Housing → McAnulty. Education/Police → Andersen. Children/Social
   Development → Prime. Energy → Woods. Māori Development → Jackson. Transport →
   Utikere. Tertiary → Halbert. Disability → Radhakrishnan. Leader-level or
   whole-of-government stories → Hipkins.
4. **Attack + alternative.** Pure negativity is rare: 17 of 20 releases end on what
   Labour would do. A generated attack release without the pivot is off-tone.
5. **One idea per release.** Each release prosecutes a single story. Secondary points
   appear only as supporting sentences inside the quote, never as a second topic.
6. **Length discipline**: 250–450 words. Announcement releases with policy bullets can
   run slightly longer.
7. **Factual claims about opponents must be literally defensible** — the corpus attacks
   interpretations and outcomes hard, but underlying facts (dates, votes, dollar
   figures, who said what) are checkable. This is the standard: vicious framing, clean
   facts.

## Anti-patterns (things the corpus never does)

- No first person singular from spokespeople except constituency/members' bill contexts.
- No jargon: "fiscal consolidation", "macroeconomic headwinds", "stakeholders" — absent.
- No exclamation marks. Ever.
- No hedging ("it seems", "arguably", "some might say") — every sentence is asserted.
- No humour or memes. Dry contempt is the ceiling ("That's not a transport plan, that's
  a wishlist").
- Doesn't attack National voters — only the Government, its ministers, and its choices.

## Source corpus (all Scoop, NZ Labour Party wire, May–July 2026)

Cost Of Living Still Rising Under Luxon (17 Jul) · More Kiwis Out Of Work Under National
(16 Jul) · National's Transport Promises Hit Reality (9 Jul) · Cost Of Living Keeps
Rising As Mortgage Rates Set To Go Up (8 Jul) · Labour Will Scrap Harmful Disability
Bill (2 Jul) · Luxon Doesn't Know The Facts About Homeless (1 Jul) · Labour Rules Out
Social Housing Rent Increase (30 Jun) · Labour To Expand Apprenticeship Boost (28 Jun) ·
National's Cuts Devastating For Vulnerable Children (9 Jun) · Serious Questions Remain
On LNG Facility (9 Jun) · Patients Paying The Price For National's Funding Squeeze
(5 Jun) · LNG Facility Won't Solve Anything (4 Jun) · Government Caught Misleading
Mothers (2 Jun) · National Picks Fight With NZ's Nuclear-Free Legacy (31 May) · Govt
Guts Tertiary Education, Abandons Students (29 May) · Budget 2026 Fails Māori Again
(28 May) · Budget Leaves Kiwis To Fend For Themselves (28 May) · National Forced Into
Humiliating Education U-Turn (27 May) · Labour Bill Helps Renters Save On Energy Costs
(21 May) · Labour Will Scrap National's Fuel Excise Increase (15 May)
