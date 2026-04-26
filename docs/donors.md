# Donor consent + GDPR operational notes

Operational doc for adding donors to the public reactor page
(`/reactor`) with proper consent, and for honoring removal requests
under GDPR. Procedural — nothing here ships to users; this is the
runbook for the maintainer.

## TL;DR

- **Never auto-publish a Ko-fi donor name.** Public-on-Ko-fi is not
  consent for the supporters page on this site.
- **Always ask first** via the email template below.
- **Default to anonymous** if no reply within ~14 days.
- **Honor removal requests within 7 days.** No questions, no friction.

---

## When a donation arrives

1. Ko-fi sends a notification email to the maintainer.
2. Maintainer replies personally (one paragraph, real human voice —
   this alone separates the project from 99% of OSS donation flows).
3. Maintainer asks the consent question using the template below.
4. Wait for a response. If nothing arrives within ~14 days, default to
   anonymous (counted in the bucket, no name shown).

## Email template

### English

```
Subject: Thanks for fueling the reactor 🛢️

Hi [name from Ko-fi notification],

Just got your tip — thank you, sincerely. €<amount> covers about
<runtime delta — use the donationToRuntimeDelta() helper> of the
project's monthly burn, which means actual code shipping continues
a bit longer.

Quick question if you don't mind: I'm building a public supporters
page on nukebg.app/reactor and I'd love to recognize you. How would
you like to appear?

  [ ] Public — display name: __________
  [ ] Anonymous — count me but no name shown
  [ ] Skip — I'd rather not appear at all

By default if I don't hear back in ~14 days, you'll be listed as
anonymous (counted, no name).

Either way, thanks again. Code keeps shipping because of this.

— Antonio (yocreoquesi)
```

### Español

```
Asunto: Gracias por alimentar el reactor 🛢️

Hola [nombre de la notificación de Ko-fi],

Acabo de recibir tu donación — gracias, en serio. €<monto> cubre
aproximadamente <delta de runtime — usá el helper donationToRuntimeDelta()>
del burn mensual del proyecto, lo que significa que el código sigue
shipeando un poco más.

Una pregunta si no te molesta: estoy armando una página pública de
supporters en nukebg.app/reactor y me gustaría reconocerte. ¿Cómo te
gustaría aparecer?

  [ ] Público — nombre a mostrar: __________
  [ ] Anónimo — me cuentan pero sin nombre
  [ ] Saltar — prefiero no aparecer

Por defecto si no respondés en ~14 días, te listo como anónimo
(contado, sin nombre).

De cualquier manera, gracias de nuevo. El código sigue avanzando
gracias a esto.

— Antonio (yocreoquesi)
```

> Other locales (fr / de / pt / zh) are operational, not user-facing.
> Translate if you happen to share a common language with the donor;
> otherwise English is fine.

## Editing `public/donors.json`

When the response arrives, edit the JSON.

### Explicit-consent supporter

```jsonc
{
  "name": "<as approved by the donor>",
  "amount_eur": 25,
  "date": "2026-04-30",
  "consent": "explicit",
}
```

Insert into the `supporters` array. Keep ordered by date descending
so the page renders most-recent-first naturally.

### Anonymous (or no response within 14 days)

Just bump the bucket counters:

```jsonc
{
  "anonymous_count": <old + 1>,
  "anonymous_total_eur": <old + amount>
}
```

### After editing

Bump the `updated_at` timestamp to today's date. Commit:

```
chore(donors): add supporter <name|anon> €<amount>
```

Push to `dev` (or open a PR if you want CI to validate the JSON
schema first).

## Removal procedure (GDPR)

If a supporter emails asking to be removed:

1. **Acknowledge within 7 days** — short reply, confirm action.
2. **Edit `public/donors.json`**:
   - Remove the entry from `supporters` entirely, OR
   - Convert to anonymous: increment `anonymous_count` by 1 and add
     their `amount_eur` to `anonymous_total_eur`. Pick whichever the
     donor prefers; default to full removal if not specified.
3. Commit + deploy.
4. Reply to confirm removal.

**No questions asked, no friction, no "are you sure?".**

The reactor page footer surfaces the removal contact email so
supporters never have to dig:

> "If you appear here and want to be removed, email <contact> —
> done within 7 days, no questions."

## What NOT to do

- Don't auto-publish from Ko-fi public donations. "Public on Ko-fi"
  is not consent for republication on this site.
- Don't include amounts that the donor explicitly asked to keep
  private (some donors are happy to be named but not have the figure
  shown — respect that).
- Don't display the donor's email, phone, Ko-fi profile link, or any
  other identifier beyond the display name they approved.
- Don't share donor names or amounts with third parties for any
  reason.
- Don't keep dead supporters' names indefinitely if they go silent —
  if a donor emails years later asking to be removed because they no
  longer want association with the project, that's a valid request.
  Honor it the same way.

## Schema reference

`public/donors.json` shape (validated indirectly by the runtime
in `src/utils/reactor-economics.ts` via the `DonorsFile` interface):

```typescript
interface DonorsFile {
  version: 1;
  updated_at: string; // YYYY-MM-DD
  supporters: Array<{
    name: string; // as approved by the donor
    amount_eur: number; // EUR, integer or one decimal
    date: string; // YYYY-MM-DD donation date
    consent: 'explicit'; // only value accepted right now
  }>;
  anonymous_count: number; // bucket size
  anonymous_total_eur: number;
}
```
