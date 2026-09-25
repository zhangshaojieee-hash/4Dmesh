# Mobile Component Audit And Repair Plan

## Goal

The mobile screenshots in `phone-picture/` show product screens at phone widths. The required fix is not a cosmetic CSS patch. Each visible component must be judged against mobile use: information hierarchy, touch target size, overflow behavior, bottom safe areas, and whether a desktop control should remain visible, move into a drawer, or become a bottom command.

Target widths: 360px, 390px, and 430px. The app must avoid horizontal page overflow, vertical letter stacking, clipped controls, and primary actions hidden under the voice assistant or browser safe area.

## Shared Mobile Rules

| Component family | Current judgement | Mobile target | Code area | Change type |
|---|---|---|---|---|
| Global header | Reasonable desktop shell, but too much account/auth content competes with navigation on phones. | 44px logo, 44px menu, 44px notification, then either compact account chip or no auth panel. Auth routes live in drawer on phones. | `frontend/src/components/Header.tsx`, `frontend/src/index.css` | React + CSS |
| Mobile drawer | Concept is right, but search, nav, user card, and account actions are oversized and loosely grouped. | Header, search, primary nav, account/auth area, secondary actions as clear grouped sections with stable 44px targets. | `Header.tsx`, `index.css` | React + CSS |
| Voice assistant | Useful global action, but it overlaps repeated content and bottom command bars. | Floating button reads `--voice-chat-bottom-offset`; command-bar screens raise it, non-command screens keep it low. Open panel fits within viewport. | `VoiceChat.tsx`, `index.css` | CSS variable + class hooks |
| Horizontal option rows | Desktop rows are being squeezed into narrow columns, producing vertical text. | Search/tabs/chips/toolbars scroll horizontally when option count is high; actions become 1 or 2 column grids. | `Models.tsx`, `GcodeEditor.tsx`, `AICreate.tsx`, `DeviceControl.tsx`, `index.css` | React classes + CSS |
| Bottom commands | Existing fixed bars help, but pages do not reserve enough bottom space or coordinate with voice. | One bottom command bar per workflow, page bottom padding equals command bar + safe area + voice clearance. | `AICreate.tsx`, `GcodeEditor.tsx`, `DeviceControl.tsx`, `index.css` | React + CSS |

## Screenshot Audit

### `30963e6fbd181e9f9a557823a8e6b266.jpg` - Mobile Navigation Drawer

| Visible component | Reasonableness | Problem | Target mobile form | Code/class | Type |
|---|---|---|---|---|---|
| Drawer shell | Correct pattern. | Drawer nearly full width and feels like a desktop side panel. | `min(86vw, 340px)`, safe-area aware, scrollable content, stronger section rhythm. | `.mobile-nav-drawer` | CSS |
| Drawer header logo/close | Functionally right. | Large close block and large logo consume too much first viewport. | 44-48px targets, compact brand row. | `.mobile-nav-header`, `.mobile-nav-close` | CSS |
| Drawer search | Necessary. | Input and button form two bulky blocks; search button competes with nav. | One row at >=390px, stacked only at very narrow widths. | `.mobile-nav-search` | CSS |
| Primary nav items | Necessary. | Sparse vertical list wastes space; active state is too tall. | Dense list with icon + text, 44-48px height, clear active indicator. | `.mobile-nav-links`, `.mobile-nav-item` | React + CSS |
| Account card | Useful. | Card is too large and competes with nav. | Compact identity row plus secondary account links. | `.mobile-nav-user`, `.mobile-nav-auth` | CSS |
| Logout | Clear. | It sits far from related account actions. | Keep in account section with danger tone, stable target. | `.mobile-nav-logout` | CSS |
| Voice assistant | Valuable. | It sits on drawer edge and creates visual noise. | Hide or lower prominence while drawer is open. | `body` drawer state, button title selector | CSS |

### `8a7083c095093e5eb9b33865952b4cc8.jpg` - Home, Anonymous

| Visible component | Reasonableness | Problem | Target mobile form | Code/class | Type |
|---|---|---|---|---|---|
| Header | Correct controls. | Anonymous login/register panel overflows top-right and steals viewport. | Hide desktop auth panel on phone; provide login/register in drawer and optional compact icon only if needed. | `Header.tsx`, `.header-auth-panel` | React + CSS |
| Hero title/body | Strong value prop. | Huge type fits but leaves narrow line breaks; acceptable if no overflow. | Use responsive but bounded title and single-column CTA stack. | `Home.tsx`, `.home-hero-*` | CSS |
| Primary/secondary CTA | Correct actions. | Must stay full width and not be hidden by floating controls. | Full-width 48-52px buttons. | `.home-hero-actions` | CSS |
| Feature cards | Reasonable navigation shortcuts. | Cards are tall; repeated floating assistant appears beside multiple sections. | Single column, compact icon+copy+arrow, no overlap. | `.home-feature-grid` | CSS |
| Hot model tabs/cards | Necessary discovery area. | Tabs duplicate/clip and cards are empty-state dominated. | Horizontal chips, one-column cards, upload CTA within empty card. | `Home.tsx`, `ModelCard.tsx` | CSS |
| Voice assistant | Useful. | Repeated visible positions indicate sticky/floating overlap during scroll. | One fixed position, avoid content edges. | `VoiceChat.tsx`, CSS variable | CSS |

### `9ba16c339bf2cc2c1099f5ba930f8ae6.jpg` - Model Library, Authenticated Results

| Visible component | Reasonableness | Problem | Target mobile form | Code/class | Type |
|---|---|---|---|---|---|
| Header user chip | Useful for authenticated state. | User chip nearly half the width; okay only if text truncates. | Compact account chip with avatar, truncated name/email, dropdown fixed to viewport. | `.user-identity-card`, `.user-dropdown` | CSS |
| Search module | Essential. | Tags wrap into narrow vertical pills; upload button floats after tags. | Search full width; hot tags in horizontal scroller; upload as full-width secondary row. | `Models.tsx`, `.market-compact-search-row` | React + CSS |
| Main tabs | Correct categories. | Row clips at right and active underline may push layout. | Horizontal tablist with scroll snap and 44px targets. | `.market-tabs`, `.market-tab-item` | CSS |
| Sort/view toolbar | Required. | Sort label and toggles compete with tabs, can clip. | Sort row below tabs, view toggles fixed width, clear filters shown only when active. | `.market-toolbar-right` | CSS |
| Model card thumbnail | Good visual anchor. | Large but acceptable; badges must not collide. | Stable aspect ratio, badge corners fixed. | `ModelCard.tsx`, `.market-model-thumb` | CSS |
| Model card metadata | Useful. | Author/stats/rating crowd a narrow card. | Author left, stats right with wrapping disabled, rating row compact. | `ModelCard.tsx` | React + CSS |
| Card actions | Correct hierarchy. | Primary and icon actions must not overlap voice/filter. | Primary full width; icon buttons 44px, secondary row below on very small width. | `.market-model-actions` | CSS |
| Filter button | Correct mobile affordance. | It can be hidden under voice near bottom. | Fixed/sticky bottom filter bar or safe bottom spacing. | `.market-mobile-filter-button` | CSS |

### `aadf89a12837021d7f419c60f25aa1fd.jpg` - G-code Initial State

| Visible component | Reasonableness | Problem | Target mobile form | Code/class | Type |
|---|---|---|---|---|---|
| Header user chip | Same as authenticated header. | Takes space but can work with truncation. | Compact, fixed dropdown. | `Header.tsx` | CSS |
| Workbench title/status | Useful. | Title and status chips are squeezed; "参数/操作" appear as vertical text. | Title row with status below; mobile tool buttons as icon+label compact chips. | `.gcode-mobile-header-actions` | React + CSS |
| Preview tabs | Necessary. | Tab labels stack vertically. | Horizontal segmented control with nowrap labels. | `.gcode-preview-switch` | CSS |
| Empty preview | Correct state. | Body is centered but import buttons below are squeezed. | Empty message above a 2-column import method grid. | `GcodeEditor.tsx`, `.gcode-empty-actions` | React + CSS |
| Import source buttons | Necessary. | Four desktop buttons force vertical text; one is partly hidden by voice. | 2-column cards, primary import highlighted, long labels wrap by phrase not characters. | `GcodeEditor.tsx` | React + CSS |
| Voice assistant | Useful but intrusive. | Covers import action. | Raise above bottom command, avoid empty-state button area. | `VoiceChat.tsx`, `index.css` | CSS |

### `b8e32de7503297a5aac1f6b9726e2d1b.jpg` - AI Creation Settings

| Visible component | Reasonableness | Problem | Target mobile form | Code/class | Type |
|---|---|---|---|---|---|
| Settings sheet | Right mobile pattern. | Sheet and overlay are too wide/tall; close button dominates. | Bottom sheet with sticky header, 90dvh max, internal scroll. | `.ai-create-side-panel` | CSS |
| Mode tabs | Correct. | Tabs are pill-like but oversized. | 3 equal segmented tabs, no vertical wrapping. | `.ai-create-tabs-wrapper` | CSS |
| Upload drop zone | Correct input. | Too tall and text may crowd. | Compact upload card with icon, title, helper text. | `.ai-upload-box` | CSS |
| Quality options | Required. | Three cards exceed width and voice covers the quality card. | Three-column at 430px, one-column or horizontal scroller at 360px; stable 56px min. | `QUALITY_OPTIONS`, `.ai-quality-grid` | React + CSS |
| Voice assistant | Useful. | Covers quality option. | Raise when side panel or command bar open. | `AICreate.tsx`, CSS var | CSS |

### `ca08f0d50c9b16f237e5438e64faebf4.jpg` - AI Result Empty Viewer

| Visible component | Reasonableness | Problem | Target mobile form | Code/class | Type |
|---|---|---|---|---|---|
| Viewer empty state | Clear. | Excess whitespace okay, but bottom action bar overlaps visual region. | Viewer reserves bottom inset and centers empty state above actions. | `.ai-preview-*` | CSS |
| Bottom command bar | Correct pattern. | Voice overlaps above primary action area. | Fixed command bar with 2 equal buttons and reserved bottom padding. | `.ai-mobile-command-bar` | CSS |
| Settings/restart buttons | Right actions. | Need touch stability and no text clipping. | 48px height, no vertical text, secondary clear. | `AICreate.tsx` | CSS |

### `f718bedefa10698c750353e2bbb1304a.jpg` - Model Library, Anonymous Empty

| Visible component | Reasonableness | Problem | Target mobile form | Code/class | Type |
|---|---|---|---|---|---|
| Anonymous auth panel | Not reasonable on phone. | Login/register panel clips from top. | Move auth to drawer; hide desktop panel. | `Header.tsx`, `.header-auth-panel` | React + CSS |
| Search/hot tags/upload | Required. | Hot tag label and pills stack into vertical characters. | Label and chips in horizontal row, upload full width under tags. | `Models.tsx` | React + CSS |
| Tabs/sort/view | Required. | Combined rows overflow and voice covers toggles. | Tabs scroller; toolbar scroller; bottom voice offset. | `.market-tabs`, `.market-toolbar-right` | CSS |
| Empty state | Correct. | Empty card is too tall and button could be covered at bottom. | Compact empty card with centered action, safe bottom padding. | `.market-empty-box-compact` | CSS |

### `fdae0c7ad2c863079690f8ff3e208533.jpg` - Device Empty State

| Visible component | Reasonableness | Problem | Target mobile form | Code/class | Type |
|---|---|---|---|---|---|
| Fleet summary | Useful. | Second card is clipped offscreen with no clear scroll affordance. | 2-column grid on phone or horizontal cards with snap and padding. | `FleetSummaryStrip`, `.fleet-summary-strip` | CSS |
| Empty state | Correct. | Action buttons are tall ovals with vertical text. | 1-column or 2-column action grid with 44-48px buttons, no text stacking. | `DeviceControl.tsx`, `.device-empty-actions` | React + CSS |
| Add methods | Useful, but redundant when empty state actions exist. | Large cards can compete with empty state. | Use add/help/filter bottom command; methods live in mobile panel. | `.add-device-methods-section` | CSS |
| Bottom command bar | Correct. | Good actions, but voice covers right side and content behind bar. | Reserve bottom space and raise voice. | `.device-mobile-command-bar` | CSS |

## Implementation Checklist

- [ ] Header: hide anonymous desktop auth panel at phone widths, make authenticated account chip truncation deterministic, add drawer account grouping.
- [ ] Voice: use existing `--voice-chat-bottom-offset` and add body/page states that raise or hide the button when drawers/sheets are open.
- [ ] Models: make search/header structure explicit, hot tags horizontal, upload full-width, tabs/toolbar separated, model card actions stable.
- [ ] G-code: add semantic classes to empty import actions and bottom panel controls; convert mobile import choices to cards.
- [ ] AI create: make settings sheet and quality/upload controls mobile-native; reserve bottom space for command bar.
- [ ] Device: add semantic empty action class, make summary/cards fit, convert empty actions from vertical ovals to usable buttons.
- [ ] Verification: run `cd frontend; npm run build`; then inspect 360/390/430px for no horizontal overflow and no vertical-letter buttons.
