// Data model of the wiki. Every collection lives under worlds/{worldId}/... in Firestore.
// See docs/SCHEMA.md for the full description of collections and relations.

export type Role = 'owner' | 'master' | 'player'

/** Who can read a record. `custom` = masters + the listed players (allowedUids). */
export type Visibility = 'public' | 'members' | 'master' | 'custom'

export interface Visible {
  visibility: Visibility
  allowedUids: string[]
  createdBy: string
}

export interface Stamped {
  createdAt: number
  updatedAt: number
  createdBy: string
  updatedBy: string
}

export interface World {
  id: string
  name: string
  description: string
  ownerId: string
  isPublic: boolean
  imageId: string | null
  headerImageId: string | null
  /** Bumped whenever a master narrows visibility of something: clients then do a full resync. */
  aclVersion: number
  settings: WorldSettings
  /** Last storage measurement (Settings → Ресурсы). */
  usage?: { bytes: number; docs: number; at: number; byCollection: Record<string, { docs: number; bytes: number }> }
  createdAt: number
  updatedAt: number
}

export interface CustomType {
  key: string // c_<id>
  label: string
  plural: string
  icon: string
}

export interface WorldSettings {
  /** Disabled modules (entity type keys). Everything else is on. */
  disabledTypes: string[]
  customTypes: CustomType[]
  /** Types players may create on their own. */
  playerCreateTypes: string[]
  playersCanPost: boolean
  defaultVisibility: Visibility
  dashboardPins: string[]
  /** Calendar used for "current date" widgets and reminders by default. */
  mainCalendarId: string | null
  accent: string | null
}

export interface Member {
  uid: string
  role: Role
  displayName: string
  email: string
  photoURL: string | null
  joinedAt: number
  inviteCode?: string
  characterId?: string | null
  favorites?: string[]
  /** Extra sections this member may create (on top of settings.playerCreateTypes). Set by masters. */
  createTypes?: string[]
  /** Last time the member opened the world (updated at most every few hours). */
  lastSeenAt?: number
  /** Joined by an accepted join request (not an invite link). */
  viaRequest?: boolean
}

export interface Ban {
  uid: string
  displayName: string
  email: string
  at: number
  by: string
}

export interface Invite {
  code: string
  role: Exclude<Role, 'owner'>
  createdBy: string
  createdAt: number
  expiresAt: number | null
  note: string
  worldName?: string
}

export type AttributeKind = 'text' | 'multiline' | 'number' | 'checkbox' | 'section' | 'link'

export interface Attribute {
  id: string
  name: string
  value: string
  kind: AttributeKind
  isPinned: boolean
  /** Private attributes are stored in the master-only secrets doc, never in the entity doc. */
  isPrivate?: boolean
}

export interface EntityLink {
  id: string
  name: string
  url: string
}

export interface Entity extends Visible, Stamped {
  id: string
  type: string
  name: string
  /** Free-form subtype, e.g. "Город" for a location (Kanka's "type" field). */
  kind: string
  parentId: string | null
  imageId: string | null
  headerImageId: string | null
  tagIds: string[]
  aliases: string[]
  /** Type specific fields (see entityTypes.ts). */
  fields: Record<string, any>
  attributes: Attribute[]
  links: EntityLink[]
  /** Plain-text preview used in tooltips/search. */
  excerpt: string
  /** Custom tooltip text (overrides excerpt). */
  tooltip: string
  /** Entity ids mentioned in the readable body. Used for backlinks. */
  mentions: string[]
  /** Players who may edit this entity (besides masters and the author). */
  editorUids: string[]
  /** true if the master-only secrets doc exists (secret blocks / private attributes). */
  hasSecrets: boolean
  bodyRev: number
  isTemplate: boolean
  deleted: boolean
  deletedAt: number | null
}

/** worlds/{w}/bodies/{entityId} — readable article text (secret blocks removed). */
export interface Body extends Visible {
  html: string
  rev: number
  updatedAt: number
  updatedBy: string
}

/** worlds/{w}/secrets/{entityId} — master only. Full text with secret blocks + private attributes. */
export interface Secrets {
  html: string
  attributes: Attribute[]
  gmNotes: string
  rev: number
  updatedAt: number
  updatedBy: string
}

export interface Post extends Visible, Stamped {
  id: string
  entityId: string
  title: string
  html: string
  order: number
  position: 'before' | 'after'
  isCollapsed: boolean
  deleted: boolean
}

export type RelationKind = 'generic' | 'parent' | 'spouse' | 'sibling'

export interface Relation extends Visible, Stamped {
  id: string
  sourceId: string
  targetId: string
  /** How the source relates to the target ("наставник"). */
  label: string
  /** How the target relates to the source ("ученик"). Empty = same as label. */
  reverseLabel: string
  kind: RelationKind
  attitude: number
  colour: string
  isPinned: boolean
  deleted: boolean
}

export interface OrgMembership extends Visible, Stamped {
  id: string
  organisationId: string
  characterId: string
  role: string
  status: 'active' | 'inactive' | 'unknown'
  isPinned: boolean
  order: number
}

export interface InventoryRow extends Visible, Stamped {
  id: string
  ownerId: string
  itemId: string | null
  name: string
  amount: number
  group: string
  description: string
  isEquipped: boolean
  order: number
}

export interface EntityAbility extends Visible, Stamped {
  id: string
  entityId: string
  abilityId: string
  charges: number
  usedCharges: number
  note: string
  order: number
}

export interface QuestElement extends Visible, Stamped {
  id: string
  questId: string
  entityId: string | null
  name: string
  role: string
  html: string
  colour: string
  order: number
}

export interface CalendarDate {
  year: number
  month: number // 1-based
  day: number
}

export interface Reminder extends Visible, Stamped {
  id: string
  calendarId: string
  entityId: string | null
  name: string
  year: number
  month: number
  day: number
  length: number
  colour: string
  comment: string
  kind: 'event' | 'birth' | 'death' | 'other'
  isRecurring: boolean
  recurPeriod: 'year' | 'month'
  recurUntil: number | null
}

export interface TimelineEra extends Visible, Stamped {
  id: string
  timelineId: string
  name: string
  abbreviation: string
  startYear: number | null
  endYear: number | null
  html: string
  order: number
  isCollapsed: boolean
}

export interface TimelineElement extends Visible, Stamped {
  id: string
  timelineId: string
  eraId: string | null
  entityId: string | null
  name: string
  date: string
  year: number | null
  html: string
  icon: string
  colour: string
  order: number
  isCollapsed: boolean
}

export interface MapLayer extends Visible, Stamped {
  id: string
  mapId: string
  name: string
  imageId: string | null
  order: number
  kind: 'overlay' | 'base'
  opacity: number
}

export interface MapGroup extends Visible, Stamped {
  id: string
  mapId: string
  name: string
  order: number
  isShown: boolean
}

export interface LatLng { lat: number; lng: number }

export interface MapMarker extends Visible, Stamped {
  id: string
  mapId: string
  groupId: string | null
  entityId: string | null
  name: string
  lat: number
  lng: number
  shape: 'marker' | 'label' | 'circle' | 'polygon'
  icon: string
  colour: string
  fontColour: string
  opacity: number
  size: number
  radius: number
  points: LatLng[]
  html: string
  isDraggable: boolean
}

export interface ConversationMessage extends Visible, Stamped {
  id: string
  conversationId: string
  authorEntityId: string | null
  authorName: string
  text: string
}

export interface ImageMeta extends Visible, Stamped {
  id: string
  name: string
  mime: string
  width: number
  height: number
  size: number
  chunkCount: number
  /** Small WebP data URL for grids and avatars. */
  thumb: string
  folder: string
  deleted: boolean
}

export interface Revision {
  id: string
  entityId: string
  postId: string | null
  name: string
  html: string
  createdAt: number
  createdBy: string
  createdByName: string
}

export interface Bookmark extends Visible, Stamped {
  id: string
  name: string
  icon: string
  target: 'entity' | 'type' | 'url' | 'tag'
  entityId: string | null
  typeKey: string | null
  url: string
  order: number
}

/** Collections that hang off an entity and are loaded on demand. */
export const CHILD_COLLECTIONS = [
  'posts', 'orgMembers', 'inventory', 'entityAbilities', 'questElements', 'reminders',
  'timelineEras', 'timelineElements', 'mapLayers', 'mapGroups', 'mapMarkers', 'messages',
] as const
export type ChildCollection = (typeof CHILD_COLLECTIONS)[number]

/** worlds/{w}/joinRequests/{uid} — a signed-in user asks to be let into the world. */
export interface JoinRequest {
  uid: string
  displayName: string
  email: string
  photoURL: string | null
  message: string
  /** In-app path the user came from (e.g. the article a link pointed to). */
  fromPath: string
  /** Known only for open worlds at request time; filled by the master on decision otherwise. */
  worldName: string
  status: 'pending' | 'rejected'
  createdAt: number
  updatedAt: number
  decidedBy?: string
  decidedAt?: number
}

// ======================= service level =======================

/** users/{uid} — profile mirror written on every sign-in (readable by the user and service admins). */
export interface UserProfile {
  uid: string
  displayName: string
  email: string
  photoURL: string | null
  lastSeen: number
  createdAt?: number
}

/** serviceBans/{uid} — the account was blocked by a service administrator. */
export interface ServiceBan {
  uid: string
  reason: string
  createdAt: number
  createdBy: string
}

/** service/config — settings of the whole service, edited in the admin panel. */
export interface ServiceConfig {
  /** YouTube Data API v3 key (search in music rooms). Restrict it to the site's referrer in Google Cloud. */
  youtubeApiKey: string
}

// ======================= campaigns =======================

export type CampaignRole = 'gm' | 'player'
export type CampaignStatus = 'planning' | 'active' | 'paused' | 'finished'

/**
 * campaigns/{cid}. A campaign exists next to worlds, not inside one: `worldId` only names the setting it is
 * played in. The UI requires a world for now; the model keeps it nullable so a campaign can be detached later
 * (nothing else in the campaign points into the world except optional character links of participants).
 * memberUids/gmUids mirror the participants subcollection so rules and "my campaigns" need no extra reads.
 */
export interface Campaign {
  id: string
  name: string
  description: string
  /** Small cover image as a data URL (kept inside the campaign: no dependency on a world gallery). */
  cover: string | null
  worldId: string | null
  /** Denormalized for display; players may have no access to the world itself. */
  worldName: string
  ownerId: string
  gmUids: string[]
  memberUids: string[]
  status: CampaignStatus
  /** Free text: "по пятницам в 19:00". */
  schedule: string
  nextSessionAt: number | null
  createdAt: number
  updatedAt: number
}

/** campaigns/{cid}/participants/{uid}. Not "members": that collection group means world membership. */
export interface CampaignParticipant {
  uid: string
  role: CampaignRole
  displayName: string
  photoURL: string | null
  /** Player character: an article of campaign.worldId (optional) and/or just a name. */
  characterId: string | null
  characterName: string
  joinedAt: number
  inviteCode?: string
}

/** campaigns/{cid}/sessions/{sid} — the campaign journal, one record per game session. */
export interface CampaignSession {
  id: string
  number: number
  title: string
  date: number | null
  status: 'planned' | 'done'
  html: string
  createdBy: string
  createdAt: number
  updatedAt: number
}

export interface CampaignInvite {
  code: string
  role: CampaignRole
  createdBy: string
  createdAt: number
  expiresAt: number | null
  campaignName: string
  /** The campaign's world at invite time and a world invite created together with this one (or null). */
  worldId: string | null
  worldInviteCode: string | null
}

// ======================= music rooms =======================

export interface QueueItem {
  id: string
  videoId: string
  title: string
  /** seconds, 0 = not known yet */
  duration: number
  addedBy: string
  addedByName: string
}

export type LoopMode = 'off' | 'one' | 'all'

/**
 * rooms/{rid}/tracks/{tid} — one synchronized YouTube player. Every room has the main track (music, shown as video)
 * and any number of extra layers (rain, tavern noise…) that play at the same time with their own volume.
 * Playback state: `position` seconds at server time `at`; while playing, now = position + (serverNow - at).
 */
export interface RoomTrack {
  id: string
  name: string
  kind: 'main' | 'layer'
  order: number
  queue: QueueItem[]
  current: string | null
  playing: boolean
  position: number
  at: number
  /** 0..100, set by whoever controls the room, applies to everybody (each listener also has a local volume) */
  volume: number
  loop: LoopMode
  shuffle: boolean
  /** bumped on every control change */
  rev: number
  /** name of the saved playlist the queue was last loaded from ('' = built by hand) */
  playlistName?: string
  updatedAt: number
  updatedBy: string
}

/**
 * rooms/{rid}/playlists/{pid} — a saved, named list of videos in the room ("Бой", "Таверна"…). Loading it copies
 * its items into a track's queue (replace or append); editing the playlist later does not touch the queue.
 */
export interface RoomPlaylist {
  id: string
  name: string
  items: QueueItem[]
  order: number
  createdBy: string
  createdByName: string
  createdAt: number
  updatedAt: number
}

export type RoomAccess = 'link' | 'campaign'

/** rooms/{rid} — a Watch2Gether-like listening room. */
export interface Room {
  id: string
  name: string
  ownerId: string
  ownerName: string
  /** may control playback and settings besides the owner */
  hostUids: string[]
  /** everybody who has entered (for "my rooms") */
  memberUids: string[]
  campaignId: string | null
  campaignName: string
  access: RoomAccess
  controlMode: 'hosts' | 'everyone'
  createdAt: number
  updatedAt: number
  lastActiveAt: number
}

/** rooms/{rid}/listeners/{uid} — presence, refreshed by a heartbeat while the room is open. */
export interface RoomListener {
  uid: string
  displayName: string
  photoURL: string | null
  at: number
  joinedAt: number
}

export interface RoomMessage {
  id: string
  uid: string
  name: string
  text: string
  at: number
}
