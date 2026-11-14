# Semester councils and configurable positions

Apply [202611150002_semester_councils.sql](../supabase/migrations/202611150002_semester_councils.sql) **once**, after the five earlier migrations. Refresh the dashboard afterward. Existing active officers become the active semester's council; archived snapshots and attendance are retained. Initial position limits come from the number of existing officers in each position. Review these limits in Officer Roster.

## Set up the current council

1. Open **Officer Roster → Manage council & positions** as an admin.
2. Enter a **Term name**, such as its academic year.
3. Set each position's name, directory group, and officer limit. Blank means unlimited; zero means no seats. Add/remove positions and use the arrows to change their directory order.
4. Select the officers serving this semester and choose a position for each. Deselect outgoing officers. Existing profiles, including previously inactive officers and their NFC cards, can be reused.
5. **Save council**. The server rejects duplicate memberships, invalid positions, and counts exceeding a position's limit.

Use **Add or Link Officer** for an additional officer or card enrollment. This saves the profile and its active-semester membership together. If the position is full, increase its limit or reassign an existing member first. A failed seat check also rolls back any pending-card promotion.

The council editor and new-semester form also have **Add new officer**. Saving that officer creates a reusable profile immediately; save the council or start the semester to include it in the reviewed roster. Canceling the council draft leaves the newly saved profile in the directory, without adding it to that council.

Removing a current member trims their recurring and custom assignments **from today onward**. Earlier calendar assignments remain linked to their saved schedule version. Former members' metadata remains available for historical attendance. Reassigning someone within an active semester updates that semester's position; positions are preserved independently between semesters, rather than tracked as daily position changes.

## Start the next semester

End the current semester, then open **Semesters → Start a New Semester**. Choose a previous council and one of:

| Choice | Result |
|---|---|
| **Same council** | Copy the serving members, their positions, term name, and position limits into the new semester. |
| **New council** | Start with the previous roster as a draft. Change the name, positions and limits; deselect outgoing officers; select returning officers; add new profiles. |

The new semester must start after the earlier semesters end. The existing database constraint still permits only one active semester. Carrying forward creates an independent copy: editing the second semester does not rewrite the first. Configure the new semester's weekly assignments in **Day Config** after creation; weekly schedules are not automatically copied.

An officer keeps the same profile identity and NFC card when returning in another position. Attendance stays attached to that identity, while the calendar, analytics, and exports use the position recorded for the selected semester. Attendance imports can still create historical profiles without placing them automatically in the current council.

Imports also retain a semester identity snapshot for an attendee who is outside
that council. This preserves their position for historical reports without
giving them a serving membership or consuming a position's seats.

## Access and reader behavior

**Officer Roster is admin-only**, including its route, navigation entry, raw profile reads, and photographs. A secretary managing councils needs the existing `admin` application role. There is no separate secretary permission tier. Approved `officer` accounts retain Live Kiosk, Log History, and Calendar access; those reports resolve identities from semester snapshots.

The reader recognizes enrolled members serving in the semester covering the scan date. Outgoing officers' current scans stay pending, visible by UID in Live Kiosk and excluded from officer analytics until identified by an admin. Delayed offline scans from a previous semester still resolve using that semester's council. Uploaded event receipts remain acknowledged even after a roster change. Dates outside any semester retain the legacy active-profile behavior.

Officer profiles and website sign-in accounts are separate. Removing a council member does not revoke their website account. Account roles continue to be managed through Supabase Auth and `public.user_roles`.

## Verification

`npm test` covers roster drafts, configurable seats, reassignment, semester creation choices, directory ordering, historical reporting, and member reports without access to the raw profile registry. `scripts/test_database.py` applies all real SQL migrations in a disposable database and checks adoption, carried councils, new councils, permissions, atomic enrollment, historical scan eligibility, assignment pruning, and single-active-semester rules. `npm run build` checks production compilation. No production migration is applied by these tests.
