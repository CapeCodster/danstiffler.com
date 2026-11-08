# My Travels Workbook Contract

Status: data contract included in the type-aware activity revision; final Excel workbook and import screen deferred until Dan and Chad approve the activity structure.

## Included In This Revision

- A versioned four-sheet model generated from the same fields used by My Travels: `Trip Details`, `Activities`, `Flight Legs`, and `Documents`.
- Required-column metadata, dropdown values, field instructions, and examples.
- Stable `trip_id`, `activity_id`, `leg_id`, and `document_id` relationships.
- Accommodation subtypes: Hotel Or Resort, Airbnb Or Vrbo, Bed And Breakfast, Friends Or Family, and Other Accommodation.
- Separate reserved stay dates and expected arrival/departure dates and times.
- Private rental access and checkout instructions. These fields use the same protected server record and encrypted offline package as the app; they are never public fields.
- Pure review and merge logic that classifies proposed additions, changes, unchanged records, missing required information, warnings, and revision conflicts.
- Merge behavior that keeps existing document attachments and stable identities unless the user expressly accepts a reviewed replacement.
- Flight-leg rows that preserve one underlying journey while supporting multiple legs, local dates, local times, time zones, terminals, seats, and optional per-leg booking details.
- A cabin dropdown on each flight leg with First Class, Business, Premium Economy, and Main Cabin. Existing airline-specific legacy values remain readable but are not offered for future entry.
- Simple traveler seat cells: complete only Dan's seat for a solo Dan flight, only Ken's for a solo Ken flight, or both for a shared flight. Confirmation/receipt extraction can populate the same cells.

The executable contract is in `trip/js/activity-spreadsheet.js` so the eventual Excel generator uses the app’s actual field definitions instead of a separately maintained list.

## Deferred Until Structure Approval

- The final formatted `.xlsx` file with Excel tables, frozen headers, validation dropdowns, instructions, and example rows.
- The user-facing file picker and drag-and-drop import screen.
- Parsing an uploaded `.xlsx` file in the browser.
- The visual review-and-merge workflow and its final server mutation submission.
- A user-facing export/download command.

Those deferred features will consume this contract and review engine. Destination day/night hero artwork is outside the workbook model and remains a separate workflow.

## Merge Safety Rules

1. Existing IDs are never replaced by row order or title matching.
2. Workbook changes are compared with the exported `base_revision`.
3. If the app changed after export, the proposed workbook change is a conflict and is not automatically applied.
4. Missing required information is reported before merge.
5. Existing protected attachments remain attached unless a later reviewed document operation explicitly changes them.
6. A proposed new record must receive a unique stable ID before it can be imported.
7. Private access instructions are handled as private data and are included in offline storage only inside the encrypted traveler package.
