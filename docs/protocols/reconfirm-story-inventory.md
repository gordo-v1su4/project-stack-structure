# Reconfirming a story after adding footage

Appending footage changes the source context. The existing arrangement remains
saved for review; it does not become current merely because its old signature was
copied or because a preview was opened. Opening Story never publishes a rebuilt
arrangement.

An explicit story confirmation prepares the current song/story/source model and
then validates the previous arrangement against it. For an unchanged song and
story-window layout, every accepted placement and deliberate gap is retained
exactly, including its ID, physical source interval and song interval. Each source
must retain matching scene content-hash evidence and source identity, fit its
current available range, and play at the original duration. Faithful arrangements
must not reuse physical source frames. Changed or missing inputs fail with an
explanation while the previous arrangement remains untouched.

Only after those checks does the app bind the reviewed current inventory to a new
placement signature and revision. New footage becomes searchable source inventory;
it does not automatically replace accepted clips or fill deliberate gaps. Choosing
additional shots or a new arrangement remains an explicit edit. Generated asset
history is retained; previous generated targets remain bound to their original
plan and cannot silently enter the reconfirmed edit.

`StoryTab` receives the stored project through `existingProject` so preservation
uses the actual accepted arrangement, rather than its stale preview projection.
`preserveReviewedStoryArrangement` implements the validation and immutable merge.
The app's parent commits its result only from the confirmation event.
