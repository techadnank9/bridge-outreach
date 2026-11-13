# OutreachDemo rehearsal

Gold copied: `dark-hero` (Stageshow). Kept its stage size class, the window inset
top-left and running off the right and bottom, the sidebar of placeholder nav,
the row grid, and the one-pill status change with a crossfading mark and an
easing label width.

Changed for Bridge Outreach:
- The story is the review queue: a lead lands (Researching), its why-now line
  resolves over its placeholder (Draft ready), the cursor presses Approve
  (Sent), and a reply comes back (Replied, the one lit color).
- Four status words instead of two; the label cell eases to each word's width.
- A real Approve button from the kit, marked `data-target="approve"`.
- On phones (compact) the button has no room, so the script skips the cursor
  and the status alone carries the story.
- On the sign-in page the stage runs off the page's right edge and fades at
  its foot (`fade-crop`), instead of sitting as a box.

Checked: stills at 1440 wide in headless Chrome at about 3s and 7.5s, the
phone layout at 390 wide in a real viewport (shows the Replied payoff), the
poster state, and that nothing overflows the phone column.

Not checked: Stageshow's `film.mjs --gate` rehearsal (its playground was not
set up in this project), the full loop seam frame by frame, and reduced motion
on a real device.
