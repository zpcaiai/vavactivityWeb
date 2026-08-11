# Content card pattern

Use the content card pattern for public-facing collections whose items have a label, title,
summary, metadata, and one primary navigation action. Course, activity, counseling, catalog,
membership, editorial, and experience-task cards share this hierarchy.

## Variants

- `content-card`: standard catalog card with an equal-height body.
- `content-card--compact`: shorter account, participant, editorial, or task card.
- `content-card-body`: vertical content stack; may be placed on the card or an inner body.
- `content-card-footer`: bottom-aligned metadata and navigation action.
- `content-card-actions`: wrapping button group for cards with multiple operations.

Standard cards use the relaxed collection rhythm: a 20–23rem minimum height, 24–32px
responsive padding, a readable title line-height, and a separated footer with pill-shaped
metadata and navigation actions. Compact cards retain the same hierarchy with a lower minimum
height and smaller title scale. At narrow viewports, footer controls stack to the full card width.

## Tokens

Typography uses the VAV font-size and line-height tokens. Spacing uses `--vav-space-*` tokens;
colors, borders, radii, and minimum touch targets use semantic VAV component tokens. Avoid
page-level heading sizes and hardcoded light-theme colors inside cards.

## Accessibility

- Keep the item name in a semantic heading and the destination in a real link.
- Decorative arrows use `aria-hidden="true"`.
- Dates use `time` with a machine-readable `datetime` value.
- Buttons and links retain the minimum VAV touch target and visible focus treatment.
