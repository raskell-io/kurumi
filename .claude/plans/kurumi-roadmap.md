# Kurumi implementation roadmap and build spec

## 1. Product goal

Kurumi is a local-first, cross-device personal memory assistant that lets the user offload thoughts, voice notes, meetings, and loose intent into a durable knowledge system that can summarize, recall, and suggest actions.

It must work across:

- work laptop
- personal phone
- home desktop
- travel/offline situations

It must support:

- typed capture
- voice capture
- local and remote meeting recording
- transcription
- summarization
- semantic recall
- controlled action suggestions
- dual inference modes: local models and remote APIs

## 2. Core product principles

1. Capture-first, chat-second
2. Local-first, not local-only
3. Human-in-the-loop by default
4. Graph-native memory model, tree-assisted navigation
5. Inference is policy-routed, not hardcoded to one provider
6. Meeting intelligence is first-class
7. Privacy and inspectability matter more than agentic flashiness

## 3. Non-goals for initial versions

Do not prioritize these before the core loop is excellent:

- fully autonomous agents
- broad plugin marketplace
- background always-listening behavior
- uncontrolled action execution
- team collaboration as primary mode
- deep external app control

## 4. User stories

### 4.1 Capture

- As a user, I can quickly type a note and save it instantly.
- As a user, I can record a voice memo and have it transcribed.
- As a user, I can share text, links, files, or screenshots into Kurumi.
- As a user, I can start a meeting recording mode.

### 4.2 Meetings

- As a user, I can record an in-person meeting with my microphone.
- As a user, I can record a remote meeting from my current device where supported.
- As a user, I can upload an existing meeting recording.
- As a user, I get a transcript with timestamps.
- As a user, I get a concise summary, action items, decisions, and key topics.

### 4.3 Recall

- As a user, I can search exact text across my notes and meetings.
- As a user, I can ask Kurumi semantic questions over my memory.
- As a user, I can browse by project, person, topic, meeting, or timeline.

### 4.4 Assistance

- As a user, Kurumi can suggest follow-ups, reminders, tasks, and drafts.
- As a user, I can approve or reject suggested actions.
- As a user, I can choose privacy and inference policies.

## 5. System architecture

```
Clients
├─ PWA web app
├─ Installed desktop PWA
├─ Mobile PWA and optional native wrapper later
│
├─ local DB
├─ offline queue
├─ media capture
├─ search cache
└─ UI

Backend
├─ auth and sync API
├─ memory object API
├─ processing job API
├─ reminders/actions API
└─ policy engine

Processing
├─ transcription service
├─ summarization/extraction service
├─ embeddings/indexing service
├─ TTS/realtime voice service
└─ inference router

Storage
├─ local IndexedDB on device
├─ remote canonical DB
├─ blob/object store for media
└─ vector/embedding index
```

## 6. Knowledge base design

### 6.1 Structural model

Kurumi must not be a pure folder tree. Use:

- shallow tree for navigation
- graph model for truth
- controlled vocabulary and aliases for coherence
- full-text + semantic retrieval for recall

### 6.2 Navigation tree

Top-level spaces:

- Personal
- Work
- Shared
- Archive

Within each space:

- Inbox
- Projects
- People
- Topics
- Meetings
- Tasks
- References

This tree is a UI affordance only.

### 6.3 Graph model

Every memory object can relate to multiple other objects. Example relation types:

- relates_to
- mentions
- belongs_to_space
- produced
- follows
- blocks
- depends_on
- aliases
- supersedes
- derived_from

### 6.4 Controlled nomenclature

Kurumi must maintain canonical names and aliases.

Examples:

- Canonical topic: `local-inference`
- Aliases: `local ai`, `on-device ai`, `offline inference`

Canonical categories:

- project
- person
- topic
- place
- organization
- source
- workflow status

### 6.5 Tag classes

Do not use a single undifferentiated tag bag. Use 4 classes:

**Type labels**
- note
- meeting
- voice-memo
- task

**Domain labels**
- security
- microbiology
- travel

**Entity labels**
- project:kurumi
- person:milan
- org:helvetia

**Workflow labels**
- inbox
- follow-up
- blocked
- done

### 6.6 Ontology maintenance

Build recurring background or user-triggered jobs to:

- merge duplicate tags
- detect alias candidates
- normalize capitalization/spelling
- propose canonical renames
- flag low-value tags

## 7. Data model

### 7.1 MemoryObject

```
MemoryObject
- id
- type
- space
- parent_bucket
- title
- raw_text
- body_markdown
- raw_audio_ref
- raw_media_ref
- transcript
- transcript_segments[]
- summary_short
- summary_long
- created_at
- updated_at
- captured_at
- source_device
- source_context
- language
- tags[]
- controlled_labels[]
- participants[]
- entities[]
- projects[]
- topics[]
- dates[]
- action_items[]
- decisions[]
- related_memory_ids[]
- visibility_scope
- processing_state
- confidence_scores
- embedding_ref
- deleted_at
```

### 7.2 MeetingMetadata

```
MeetingMetadata
- memory_object_id
- capture_mode
- started_at
- ended_at
- platform
- diarization_enabled
- consent_notice_shown
- transcript_status
- summary_status
```

### 7.3 ActionItem

```
ActionItem
- id
- memory_object_id
- text
- assignee
- due_date
- status
- confidence
```

### 7.4 Entity

```
Entity
- id
- type
- canonical_name
- aliases[]
- description
- links[]
- related_entity_ids[]
```

### 7.5 Relation

```
Relation
- id
- from_object_id
- relation_type
- to_object_id
- confidence
- created_by
```

## 8. Inference architecture

### 8.1 Requirement

Kurumi must support both:

- remote API inference
- local inference

### 8.2 Inference Router

Build a routing layer that selects execution target based on:

- user preference
- workspace policy
- data sensitivity
- device capability
- online/offline state
- task type
- context size
- latency tolerance
- battery/power constraints

### 8.3 User-facing inference policies

- Auto
- Private-first
- Best-quality
- Offline-only
- Work-safe

### 8.4 Backend abstraction

Define task-level interfaces, not provider-specific ones. Required methods:

- `summarize(input, options)`
- `summarize_meeting(transcript, options)`
- `rewrite_transcript(input, options)`
- `extract_entities(input, options)`
- `extract_action_items(input, options)`
- `classify_memory(input, options)`
- `answer_with_context(question, context, options)`
- `generate_title(input, options)`
- `propose_canonical_labels(input, options)`
- `merge_alias_candidates(input, options)`
- `tts(input, options)`
- `realtime_session_start(options)`

### 8.5 Local inference

Treat local inference as a real execution path, not a demo feature.

Initial local model strategy:

- small local model for title/summary/tag extraction
- medium local model for transcript cleanup and meeting chunk summaries
- larger local model for desktop-grade private recall and synthesis

Gemma 4 family can be used as the first-class local backend family.

Local runtimes should be adapter-based, with at least:

- Ollama adapter
- lower-level local runtime adapter later

### 8.6 Remote inference

Remote inference is used for:

- best-quality reasoning
- large cross-memory synthesis
- high-end meeting synthesis
- realtime voice mode
- tasks requiring large context or better model quality

### 8.7 Hybrid pipeline examples

**Meeting pipeline**

1. Capture audio/video
2. Send to ASR/transcription service
3. Clean transcript
4. Chunk transcript
5. Summarize each chunk using local or remote model
6. Produce final structured meeting summary
7. Extract actions/decisions/entities
8. Link to graph

**Note capture pipeline**

1. Save raw text or transcript locally
2. Generate title
3. Generate short summary
4. Extract tags/entities
5. Propose canonical labels
6. Embed and index

## 9. Recording and meeting capture design

### 9.1 Recording modes

Kurumi must support these modes explicitly:

- Voice memo
- In-person meeting
- Remote meeting basic
- Remote meeting enhanced
- Upload existing recording

### 9.2 Recording mode definitions

**Voice memo**
- mic only
- short-form personal capture

**In-person meeting**
- mic only
- long-form capture
- diarization if available

**Remote meeting basic**
- mic only
- fallback when system capture is unavailable

**Remote meeting enhanced**
- mic + selected window/tab/screen audio where supported
- show clear compatibility/permission messaging

**Upload existing recording**
- upload audio or video file for later processing

### 9.3 Recording UX requirements

- single obvious Record CTA
- show selected mode before capture starts
- show permissions required
- show timer and recording state
- support pause/resume
- support segmented upload for long recordings
- prevent data loss on tab close or app backgrounding where possible

### 9.4 Transcript viewer requirements

- timestamped transcript
- segment-based rendering
- speaker labels if available
- click-to-jump in recording playback
- highlight extracted action items/decisions/topics

### 9.5 Meeting summary output structure

Every processed meeting should produce:

- title
- concise summary
- full summary
- participants mentioned
- key topics
- action items
- decisions
- unresolved questions
- follow-up suggestions

## 10. Retrieval and recall design

### 10.1 Retrieval modes

Implement all of these:

- exact search
- filtered search
- semantic search
- ask Kurumi over retrieved context
- timeline browsing
- entity/project/topic pages

### 10.2 Entity pages

Auto-generate living pages for:

- projects
- people
- topics
- organizations
- places

Each entity page should show:

- related memories
- recent activity
- open action items
- meetings
- decisions
- unresolved threads

### 10.3 Recall assistant behavior

When answering a question, Kurumi should:

1. retrieve relevant memory objects
2. rank by relevance and recency
3. assemble a bounded context
4. answer with traceability back to source memories
5. optionally suggest follow-up actions

## 11. Privacy and policy model

### 11.1 Scopes

Each memory object must have a scope:

- personal
- work
- shared
- archived

### 11.2 Processing policy

Each space/workspace can define:

- local-only processing
- remote allowed
- approved remote providers
- retention period
- embedding enabled or disabled
- voice features enabled or disabled

### 11.3 Required user controls

- export memory object
- delete memory object
- bulk delete by scope/date
- view raw transcript
- view generated summary
- re-run processing
- switch inference mode

## 12. UI and information architecture

### 12.1 MVP screens

- Home / Recent
- Inbox
- Quick capture sheet
- Record screen
- Meeting mode selector
- Upload screen
- Search
- Ask Kurumi
- Memory detail
- Entity detail
- Daily recap
- Settings

### 12.2 Home screen sections

- recent captures
- continue unfinished items
- today summary
- suggested follow-ups
- pinned projects/topics

### 12.3 Memory detail screen

- raw source
- transcript
- summary
- action items
- entities/topics/projects
- linked memories
- playback if audio/video exists
- processing log/status

### 12.4 Settings

- sync status
- inference policy
- local model config
- remote provider config
- privacy policy
- transcription settings
- meeting capture preferences

## 13. Backend services and APIs

### 13.1 Required services

- auth service
- sync service
- memory API
- media upload API
- processing job API
- embeddings/index service
- inference router service
- reminder/action API

### 13.2 API modules

**Memory**
- `createMemoryObject`
- `updateMemoryObject`
- `listMemoryObjects`
- `getMemoryObject`
- `deleteMemoryObject`
- `linkMemoryObjects`

**Media**
- `createUploadSession`
- `uploadChunk`
- `finalizeUpload`
- `attachMediaToMemory`

**Processing**
- `requestTranscript`
- `requestSummary`
- `requestEntityExtraction`
- `requestMeetingProcessing`
- `rerunProcessing`

**Search and recall**
- `searchMemory`
- `semanticSearchMemory`
- `askMemory`
- `getEntityPage`
- `getTimeline`

**Actions**
- `createReminderProposal`
- `approveAction`
- `rejectAction`
- `listActionItems`

## 14. Engineering phases

### Phase 0: architecture and design freeze

**Deliverables:**
- product spec
- domain model
- inference abstraction
- storage schema
- policy model
- wireframes
- recording capability matrix

**Exit criteria:** core concepts frozen enough to begin implementation without rethinking architecture every week.

### Phase 1: local-first capture MVP

**Deliverables:**
- text note capture
- voice memo capture
- local DB
- local queue
- sync foundation
- basic memory list
- basic search

**Exit criteria:** can capture and retrieve notes reliably on one device.

### Phase 2: transcription and summarization

**Deliverables:**
- upload media pipeline
- transcript processing
- title generation
- summary generation
- entity and tag extraction
- processing state UI

**Exit criteria:** every voice note becomes a structured memory object.

### Phase 3: meeting mode MVP

**Deliverables:**
- meeting mode selector
- mic-only meeting recording
- upload existing recordings
- transcript viewer
- meeting summary template
- action item extraction
- decision extraction

**Exit criteria:** usable for real local or uploaded meetings.

### Phase 4: enhanced meeting capture

**Deliverables:**
- remote meeting enhanced mode
- compatibility messaging
- segmented recording uploads
- longer recording stability
- speaker separation improvements

**Exit criteria:** remote meeting capture works on supported browsers/devices with clear fallbacks.

### Phase 5: graph, taxonomy, and retrieval

**Deliverables:**
- entity extraction into graph
- relation storage
- entity pages
- semantic search
- ask Kurumi over retrieved context
- canonical alias management

**Exit criteria:** Kurumi feels like a memory system, not a bag of notes.

### Phase 6: dual inference routing

**Deliverables:**
- inference router
- remote provider adapter
- local provider adapter
- policy selector
- per-space policies
- task-level routing logic

**Exit criteria:** same feature can run locally or remotely depending on policy.

### Phase 7: local inference maturity

**Deliverables:**
- initial local model packaging/instructions
- local summary pipeline
- local meeting chunk summarization
- local entity/action extraction
- desktop-grade private mode

**Exit criteria:** private-first workflows are actually useful.

### Phase 8: voice assistant mode

**Deliverables:**
- push-to-talk
- spoken responses
- realtime voice session support
- interruptible playback
- voice-based recall queries

**Exit criteria:** user can naturally talk to Kurumi for capture and recall.

### Phase 9: controlled action layer

**Deliverables:**
- reminder proposals
- email/calendar draft proposals
- approval UI
- audit log
- recurring reviews and recaps

**Exit criteria:** Kurumi advances work without becoming unsafe or noisy.

## 15. Task breakdown for coding agent

### Epic A: Storage and sync

- define local DB schema
- implement IndexedDB abstraction
- implement sync queue
- implement optimistic update model
- implement remote canonical sync endpoints
- implement conflict resolution rules

### Epic B: Capture UX

- quick capture modal
- text note flow
- audio recorder component
- capture mode selector
- upload existing media flow
- recording state management

### Epic C: Processing pipeline

- media upload session API
- chunked upload client
- transcription job orchestration
- summary orchestration
- transcript cleanup job
- extraction job orchestration
- processing state UI

### Epic D: Knowledge graph

- entity schema
- relation schema
- entity extraction persistence
- relation generation rules
- entity page endpoints
- alias merge workflow
- tag normalization workflow

### Epic E: Search and recall

- exact search index
- semantic embedding pipeline
- recall query service
- ask Kurumi endpoint
- result citation/tracing UI

### Epic F: Inference abstraction

- define inference interfaces
- implement remote adapter
- implement local adapter
- implement router policy logic
- implement per-space inference config
- add routing telemetry

### Epic G: Meeting intelligence

- meeting data model
- meeting summary template
- action item extractor
- decision extractor
- unresolved questions extractor
- participant/topic extraction

### Epic H: Voice runtime

- push-to-talk UI
- TTS playback
- voice session lifecycle
- streaming transcript UI
- speech interruption handling

### Epic I: Privacy and controls

- scope selector
- policy settings UI
- delete/export flows
- provider allowlist handling
- raw/generated view toggles

## 16. Acceptance criteria by capability

**Capture**
- new text note can be created in under 5 seconds
- voice memo starts in one tap/click
- capture works offline and syncs later

**Processing**
- transcript is attached to original memory object
- summary is generated and visible
- extracted metadata is editable

**Meetings**
- user can choose meeting mode clearly
- meeting recording survives long sessions reasonably well
- summary includes actions and decisions

**Retrieval**
- exact search returns relevant items quickly
- semantic recall answers cite source memories
- entity pages aggregate related memories correctly

**Inference**
- user can switch between Auto, Private-first, Best-quality, Offline-only, Work-safe
- local and remote adapters can both fulfill the same abstract tasks
- policy routing is visible and explainable in UI/logs

**Privacy**
- user can see what left the device
- user can force local-only for selected spaces
- user can delete or export data

## 17. Recommended implementation order

1. Freeze data model and inference interfaces
2. Build local-first capture and storage
3. Add sync and media upload
4. Add transcription and summary pipeline
5. Add meeting mode MVP
6. Add graph and entity extraction
7. Add exact + semantic retrieval
8. Add inference router
9. Add local inference backend
10. Add voice assistant mode
11. Add action proposal layer
12. Add ontology maintenance and polish

## 18. Definition of done for the whole roadmap

Kurumi is done enough for serious personal use when all of the following are true:

- it is the fastest place to capture thoughts
- it can record and summarize real meetings
- it can recall personal knowledge across devices
- it can operate in both local and remote inference modes
- it keeps a coherent evolving knowledge base through graph + taxonomy maintenance
- it suggests useful next actions without becoming a noisy autonomous agent
