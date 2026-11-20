/* Motion Dojo Connect: shared types */

export type Profile = {
  id: string;
  handle: string;
  name: string;
  bio: string;
  avatar_url: string | null;
  cover_url: string | null;
  country: string;
  skills: string[];
  phase: number | null;
  /** false: only the student (and the team) see their phase */
  phase_public?: boolean;
  /** Students on the team: their role, e.g. "Community manager" */
  team_role?: string | null;
  /** the post shown first on their profile */
  pinned_post_id?: string | null;
  /** The phase a student says they're in, waiting for the team to confirm */
  phase_request?: number | null;
  phase_request_at?: string | null;
  /** The team declined their last request: they choose again */
  phase_declined_at?: string | null;
  instagram: string;
  youtube: string;
  website: string;
  /** Any links the member adds; the platform is recognised from the address */
  links?: string[];
  is_student: boolean;
  is_moderator: boolean;
  /** The grand sensei: posts to the Community feed */
  is_sensei: boolean;
  created_at: string;
  /** When they last had Connect open (for "last seen") */
  last_seen_at?: string | null;
  /** Group notifications: important only (default), all, or off */
  alert_level?: AlertLevel | null;
  /** Preview only: marks invented sample data */
  sample?: boolean;
};

export type AlertLevel = 'important' | 'all' | 'off';

export type Post = {
  id: string;
  author_id: string;
  /** text posts have no media; video is an uploaded file or a YouTube/Vimeo/Instagram/TikTok link */
  kind: 'image' | 'video' | 'text';
  media_url: string | null;
  caption: string;
  tag: 'sharing' | 'feedback';
  /** A grand sensei post on the Community feed */
  community: boolean;
  /** An approved phase assignment: shows "Passed phase N" */
  assignment_phase?: number | null;
  created_at: string;
  author: Profile;
  likes: number;
  comments: number;
  liked: boolean;
  saved: boolean;
};

export type ConnectionStatus = 'none' | 'requested' | 'incoming' | 'connected';

export type Notice = {
  id: string;
  kind: 'community_post' | 'connection_request' | 'connection_accepted' | 'assignment_submitted' | 'assignment_approved' | 'assignment_changes' | 'group_reply' | 'group_mention' | 'phase_request' | 'phase_approved' | 'phase_declined' | 'challenge_new' | 'challenge_pick' | 'post_like' | 'post_comment';
  /** Group replies and mentions: "Name: what they wrote" */
  snippet?: string | null;
  actor: Profile | null;
  post_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type Comment = {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author: Profile;
};

export type Conversation = {
  id: string;
  other: Profile;
  last_message_at: string;
  last_body: string;
  /** Messages the other person sent that I haven't opened */
  unread?: number;
  /** About the last message, for the inbox row */
  last_kind?: MessageKind;
  last_mine?: boolean;
  last_delivered?: boolean;
  last_read?: boolean;
  last_deleted?: boolean;
};

export type MessageKind = 'text' | 'voice' | 'image' | 'video' | 'file' | 'poll' | 'live' | 'call';

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  kind?: MessageKind;
  /** Path in the private chat bucket */
  media_path?: string | null;
  /** Short-lived signed link for media_path (or a local preview while sending) */
  media_url?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  /** Voice notes, in seconds */
  duration?: number | null;
  /** Photos and videos: a tiny blurred preview (data URL) shown before download */
  thumb?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  deleted_at?: string | null;
  /** Sent on from another chat */
  forwarded?: boolean | null;
  /** Changed after sending */
  edited_at?: string | null;
  /** Private chats: reactions (one per person) */
  reactions?: { emoji: string; count: number; mine: boolean; who?: string[] }[];
  /** A private reply to a group message: JSON {name, text} */
  quote?: string | null;
  /** Client only: still uploading / sending */
  pending?: boolean;
  progress?: number;
  failed?: boolean;
};

/** A message in the Dojo group */
export type GroupMessage = Message & {
  /** Polls: one entry per answer picked */
  votes?: { option: number; user_id: string }[];
  /** When someone other than the sender first saw it */
  seen_at?: string | null;
  reply_to?: string | null;
  sender?: Profile;
  /** who: the people who reacted with it */
  reactions?: { emoji: string; count: number; mine: boolean; who?: string[] }[];
};

/** What new students see from before they joined */
export type GroupHistory = 'all' | '14d' | '100' | 'none';
export type GroupInfo = { members: number; announce_only: boolean; pinned_id: string | null; muted_until: string | null; history?: GroupHistory; name?: string; photo_url?: string | null; pinned_by?: string | null; pinned_at?: string | null };

export type Challenge = {
  id: string;
  number: number;
  title: string;
  brief: string;
  ends_at: string;
  pick_id: string | null;
  pick_note: string;
  created_at: string;
  /** how many handed in */
  entries: number;
};
export type ChallengeEntry = { id: string; challenge_id: string; user_id: string; url: string; created_at: string; user?: Profile };
/** streak = challenges handed in back to back; entered_current only for members */
export type ChallengeStat = { user_id: string; streak: number; picks: number; entered_current: boolean | null };

export type BriefItem = { kind: 'image' | 'file' | 'link' | 'video'; url: string; name: string };

export type PhaseRequest = { id: string; name: string; handle: string; avatar_url: string | null; phase_request: number; phase_request_at: string };

export type CallSignal = {
  type: 'ring' | 'accept' | 'decline' | 'busy' | 'offer' | 'answer' | 'ice' | 'hangup' | 'upgrade' | 'upgrade-ok' | 'upgrade-no';
  call: string;
  from: { id: string; name: string; avatar_url: string | null };
  conv: string;
  video?: boolean;
  sdp?: RTCSessionDescriptionInit;
  ice?: RTCIceCandidateInit;
};
export type TypingSignal = { chat: string; id: string; name: string; on: boolean };
export type GroupRow = { id: string; name: string; photo_url: string | null; text: string; at: string; unread: number };
export type GroupInvite = { gid: string; name: string; photo_url: string | null; message: string; expires_at: string; members: number; sender: string | null; expired: boolean; joined: boolean };

export type GroupReader = { id: string; name: string; avatar_url: string | null; read_at: string };

export type Attachment = { file: File; kind: Exclude<MessageKind, 'text'>; duration?: number; thumb?: string };

export type ProfileInput = Partial<
  Pick<Profile, 'handle' | 'name' | 'bio' | 'avatar_url' | 'cover_url' | 'country' | 'skills' | 'phase' | 'phase_public' | 'instagram' | 'youtube' | 'website' | 'links' | 'pinned_post_id'>
>;

/** A Black Belt lesson. The video, notes and files only come with getLesson(). */
/** A live class recording (YouTube, Unlisted) */
export type LiveRecording = { message_id: string; group_id: string | null; title: string; video: string; held_at: string; on_learn: boolean };

/** Work a student handed in on one lesson */
export type LessonWork = { id: string; lesson_id: string; user_id: string; url: string; note: string; created_at: string; student?: Profile | null };

export type Lesson = {
  id: string;
  phase: number;
  position: number;
  title: string;
  summary: string;
  duration: string;
  published: boolean;
  has_video: boolean;
  /** Video size in MB, so students know the data it uses */
  size_mb: number | null;
  /** Tall phone video (most Alight Motion exports). Default true */
  portrait?: boolean;
  /** Pictures that are part of the lesson */
  images?: string[];
  /** A group inside the phase, like "Background music" (empty: none) */
  section?: string;
  done: boolean;
  /** Open to watch: the lesson before it is done (the team sees everything) */
  open: boolean;
  video_url?: string;
  notes?: string;
  files?: { name: string; url: string }[];
};

export type Assignment = {
  id: string;
  user_id: string;
  phase: number;
  kind: 'image' | 'video';
  media_url: string;
  caption: string;
  status: 'pending' | 'approved' | 'changes';
  feedback: string;
  reviewed_at: string | null;
  post_id: string | null;
  created_at: string;
  /** Team review list only */
  student?: Profile;
};

export type DeviceRow = { user_id: string; name: string; handle: string; email: string; label: string | null; last_seen_at: string | null; changes_7d: number; banned?: boolean };

export type LessonInput = {
  id?: string;
  phase: number;
  title: string;
  summary: string;
  duration: string;
  video_url: string;
  size_mb: number | null;
  notes: string;
  files: { name: string; url: string }[];
  published: boolean;
  portrait: boolean;
  images: string[];
  section: string;
};

export type StudentFilter = { q?: string; skill?: string; phase?: number | null };

export interface ConnectApi {
  /** 'demo' uses sample data in the browser; 'live' talks to Supabase */
  mode: 'demo' | 'live';
  /** Signed-in user's id, or null */
  session(): Promise<{ userId: string; email: string } | null>;
  onAuthChange(cb: () => void): () => void;
  /** Live updates from the database; returns a function that stops them */
  /** Who's online right now: calls back with their ids whenever it changes */
  presence(cb: (online: Set<string>) => void): () => void;
  /** Calls: signals to and from one person (ringing, answering, connection details) */
  callListen(cb: (s: CallSignal) => void): () => void;
  callSend(to: string, s: CallSignal): void;
  /** Where calls connect through (phone to phone, or Cloudflare's relay) */
  iceServers(): Promise<RTCIceServer[]>;
  /** Rings the other person's phone through a notification */
  ringPhone(conversationId: string, video: boolean): Promise<void>;
  /** "Missed voice call", "Video call · 12 min" in the chat */
  logCall(conversationId: string, call: { video: boolean; status: 'missed' | 'declined' | 'ended'; secs: number }): Promise<void>;
  /** Live "typing…" signals in a room ('u:<id>', 'g:main', 'g:<group id>') */
  typingListen(room: string, cb: (t: TypingSignal) => void): () => void;
  typingSend(room: string, t: TypingSignal): void;
  subscribe(table: 'messages' | 'comments' | 'notifications' | 'group_messages' | 'group_reactions' | 'group_settings' | 'groups' | 'message_reactions' | 'poll_votes', filter: string, cb: (change: { event: string; row: Record<string, unknown> }) => void): () => void;
  signIn(email: string): Promise<void>;
  /** Students: email + the student ID they got when they enrolled */
  studentSignIn(email: string, studentId: string): Promise<void>;
  /** Preview only: sign in instantly as a sample student or a sample visitor */
  demoSignIn?(as: 'student' | 'visitor' | 'sensei'): Promise<void>;
  signOut(): Promise<void>;

  me(): Promise<Profile | null>;
  createProfile(input: ProfileInput & { handle: string; name: string }): Promise<Profile>;
  updateProfile(input: ProfileInput): Promise<Profile>;
  refreshStudentStatus(): Promise<boolean>;
  redeemInvite(code: string): Promise<boolean>;
  /** Images are resized before upload; videos go up as they are */
  uploadImage(file: File, folder: 'avatars' | 'covers' | 'posts' | 'videos', onProgress?: (share: number) => void): Promise<string>;

  listStudents(filter: StudentFilter): Promise<Profile[]>;
  getProfile(handle: string): Promise<Profile | null>;
  counts(userId: string): Promise<{ connections: number; posts: number }>;

  connectionStatus(userId: string): Promise<ConnectionStatus>;
  requestConnection(userId: string): Promise<void>;
  /** Accept or decline a request someone sent you */
  answerRequest(userId: string, accept: boolean): Promise<void>;
  /** Cancel a request you sent, or remove an existing connection */
  removeConnection(userId: string): Promise<void>;
  listConnections(): Promise<Profile[]>;
  listRequests(): Promise<{ incoming: Profile[]; sent: Profile[] }>;

  listNotices(): Promise<Notice[]>;
  unreadCount(): Promise<number>;
  /** Messages from others I haven't opened, across all chats */
  unreadMessageCount(): Promise<number>;
  markNoticesRead(): Promise<void>;

  listPosts(opts: { authorId?: string; feed?: 'community' | 'everyone' | 'connections'; limit?: number }): Promise<Post[]>;
  listSaved(): Promise<Post[]>;
  setSaved(postId: string, on: boolean): Promise<void>;
  getPost(id: string): Promise<Post | null>;
  createPost(input: { kind: 'image' | 'video' | 'text'; media_url: string | null; caption: string; tag: 'sharing' | 'feedback'; community?: boolean }): Promise<Post>;
  deletePost(id: string): Promise<void>;
  setLike(postId: string, on: boolean): Promise<void>;
  listComments(postId: string): Promise<Comment[]>;
  /** Who liked a post, newest first */
  listLikers(postId: string): Promise<Profile[]>;
  addComment(postId: string, body: string): Promise<Comment>;
  deleteComment(id: string): Promise<void>;

  listConversations(): Promise<Conversation[]>;
  openConversation(userId: string): Promise<string>;
  getConversation(id: string): Promise<Conversation | null>;
  listMessages(conversationId: string): Promise<Message[]>;
  /** quote: a group message this answers privately, as JSON {name, text} */
  sendMessage(conversationId: string, body: string, quote?: string | null, forwarded?: boolean): Promise<Message>;
  /** Voice note, photo, video or file. Uploads privately, then sends. */
  sendAttachment(conversationId: string, a: Attachment, caption: string, onProgress?: (share: number) => void, forwarded?: boolean): Promise<Message>;
  deleteMessage(id: string): Promise<void>;
  /** Your own text, within the delete-for-everyone time */
  editMessage(id: string, body: string): Promise<void>;
  /** Group messages: they reached this phone (called when Connect opens) */
  markGroupDelivered(): Promise<void>;
  /** Group message info: when it reached each person and when they read it (null: not available) */
  groupReceipts(messageId: string): Promise<{ user_id: string; delivered_at: string; seen_at: string | null }[] | null>;
  /** Voice notes: I played it (first time only) */
  markPlayed(messageId: string): Promise<void>;
  /** Voice notes: who played it and when */
  listPlays(messageId: string): Promise<{ user_id: string; played_at: string }[]>;
  /** React to a private message; null removes yours */
  reactMessage(id: string, emoji: string | null): Promise<void>;
  /** Marks everything the other person sent in this chat as seen */
  markRead(conversationId: string): Promise<void>;
  /** Marks all incoming messages as delivered to this device */
  markDelivered(): Promise<void>;

  /** Learn: the course outline (no videos), one lesson, progress */
  listLessons(): Promise<Lesson[]>;
  /** Lessons where students hand in work (the Grand Sensei turns it on per lesson) */
  lessonWorkOpen(lessonId: string): Promise<boolean>;
  setLessonWorkOpen(lessonId: string, open: boolean): Promise<void>;
  myLessonWork(lessonId: string): Promise<LessonWork | null>;
  lessonWorkAll(lessonId: string): Promise<LessonWork[]>;
  handInLessonWork(lessonId: string, url: string, note: string): Promise<void>;
  removeLessonWork(lessonId: string): Promise<void>;
  /** Throws 'members_only', 'locked' or 'not_found' */
  getLesson(id: string): Promise<Lesson>;
  setLessonDone(id: string, done: boolean): Promise<void>;
  /** Team only */
  saveLesson(input: LessonInput): Promise<Lesson>;
  deleteLesson(id: string): Promise<void>;
  moveLesson(id: string, dir: -1 | 1): Promise<void>;

  /** Phase assignments */
  myAssignments(): Promise<Assignment[]>;
  /** Throws 'finish_lessons', 'already_sent', 'members_only' */
  submitAssignment(phase: number, kind: 'image' | 'video', mediaUrl: string, caption: string): Promise<void>;
  getBriefs(): Promise<Record<number, string>>;
  /** Team only */
  saveBrief(phase: number, brief: string, items?: BriefItem[]): Promise<void>;
  /** Pictures, documents and links attached to each phase's brief */
  getBriefItems(): Promise<Record<number, BriefItem[]>>;
  /** Team: upload a picture or document for a brief; returns its public link */
  uploadBriefFile(file: File, onProgress?: (share: number) => void): Promise<string>;
  reviewQueue(): Promise<Assignment[]>;
  reviewAssignment(id: string, approve: boolean, note: string): Promise<void>;
  /** Dojo Challenge */
  listChallenges(): Promise<Challenge[]>;
  /** members: every entry; visitors: only the picked one */
  listEntries(challengeId: string): Promise<ChallengeEntry[]>;
  submitEntry(challengeId: string, url: string): Promise<void>;
  removeEntry(entryId: string): Promise<void>;
  saveChallenge(c: { id?: string; title: string; brief: string; ends_at: string }): Promise<void>;
  deleteChallenge(id: string): Promise<void>;
  pickEntry(challengeId: string, entryId: string | null, note: string): Promise<void>;
  challengeStats(): Promise<ChallengeStat[]>;
  /** Approved final projects (phase assignments) for the Projects page */
  listProjects(phase: number): Promise<Post[]>;
  /** Grand Sensei: put a student on the team with a role (null takes them off) */
  setTeamRole(userId: string, role: string | null): Promise<void>;
  /** Phone notifications when Connect is closed; false if not possible */
  enablePush(): Promise<boolean>;
  /** Which group messages notify me */
  setAlertLevel(level: AlertLevel): Promise<void>;
  /** Sends this person a test notification; why says what went wrong */
  testPush(): Promise<{ ok: boolean; why: string }>;
  /** Everyone on the team who is also a student: id → role */
  teamRoles(): Promise<Record<string, string>>;
  /** Phase check: a student says which phase they're in; the team confirms */
  requestPhase(phase: number): Promise<void>;
  /** Team: students waiting for their phase to be confirmed */
  phaseRequests(): Promise<PhaseRequest[]>;
  /** Team: put a student in a phase, or decline (null) so they choose again */
  setStudentPhase(userId: string, phase: number | null): Promise<void>;

  /** One device at a time (students). Team accounts are exempt. */
  claimDevice(token: string, label: string): Promise<void>;
  checkDevice(token: string): Promise<boolean>;
  teamDevices(): Promise<DeviceRow[]>;
  resetMemberId(userId: string): Promise<string>;
  /** Team only: ban (or unban) and remove students */
  banUser(userId: string, on: boolean): Promise<void>;
  removeUser(userId: string): Promise<void>;

  /** The Dojo group: every student and the team.
      gid: one of the Grand Sensei's own groups (none: the community group). */
  groupInfo(gid?: string | null): Promise<GroupInfo | null>;
  listGroupMessages(gid?: string | null): Promise<GroupMessage[]>;
  groupPreview(): Promise<{ name: string; photo_url?: string | null; text: string; at: string; unread: number } | null>;
  sendGroupMessage(body: string, replyTo?: string | null, forwarded?: boolean, gid?: string | null): Promise<GroupMessage>;
  sendGroupAttachment(a: Attachment, caption: string, replyTo?: string | null, onProgress?: (share: number) => void, forwarded?: boolean, gid?: string | null): Promise<GroupMessage>;
  deleteGroupMessage(id: string): Promise<void>;
  /** Your own text, within the delete-for-everyone time */
  editGroupMessage(id: string, body: string): Promise<void>;
  /** video: the YouTube id. onLearn: also list it on Learn */
  addLiveRecording(messageId: string, video: string, onLearn: boolean): Promise<void>;
  listLiveRecordings(): Promise<LiveRecording[]>;
  getLiveRecording(messageId: string): Promise<LiveRecording | null>;
  /** Team: a poll or a live class (body is JSON, see special.ts) */
  sendGroupSpecial(kind: 'poll' | 'live', body: string, gid?: string | null): Promise<GroupMessage>;
  /** My answers to a poll (replaces any earlier ones; [] takes my vote back) */
  votePoll(messageId: string, options: number[]): Promise<void>;
  /** null removes your reaction */
  reactGroup(id: string, emoji: string | null): Promise<void>;
  markGroupRead(gid?: string | null): Promise<void>;
  /** When I last read the group (null: never) */
  groupLastRead(gid?: string | null): Promise<string | null>;
  /** Members and when they last had the group open */
  groupReaders(gid?: string | null): Promise<GroupReader[]>;
  /** Team only */
  setGroupSettings(s: { announce_only?: boolean; pinned_id?: string | null; history?: GroupHistory; name?: string; photo_url?: string | null }, gid?: string | null): Promise<void>;
  /** Everyone in the group: students and the team */
  groupMembers(gid?: string | null): Promise<Profile[]>;
  /** Am I in the group, removed from it, banned from it, or not a member at all */
  groupStatus(gid?: string | null): Promise<'member' | 'removed' | 'banned' | 'none'>;
  rejoinGroup(): Promise<void>;
  /** Team only */
  removeFromGroup(userId: string, ban: boolean, gid?: string | null): Promise<void>;
  addToGroup(userId: string, gid?: string | null): Promise<void>;
  groupRemoved(gid?: string | null): Promise<{ profile: Profile; banned: boolean }[]>;
  /** Team only. hours = 0 unmutes */
  muteInGroup(userId: string, hours: number, gid?: string | null): Promise<void>;

  /** Chats pinned to the top of Messages, in the order they were pinned ('group', 'g:<id>' or a chat id) */
  listPins(): Promise<string[]>;
  /** Up to 5 (the Grand Sensei: any number) */
  setPin(chat: string, on: boolean): Promise<void>;
  /** The Grand Sensei's own groups I'm in, for Messages */
  myGroups(): Promise<GroupRow[]>;
  /** Grand Sensei only; returns the new group's id */
  createGroup(name: string, photoUrl?: string | null): Promise<string>;
  deleteGroup(gid: string): Promise<void>;
  /** Returns how many were added */
  addPeopleToGroup(gid: string, userIds: string[]): Promise<number>;
  leaveGroup(gid: string): Promise<void>;
  /** A link code valid for 3 days */
  createInvite(gid: string, message: string): Promise<string>;
  getInvite(token: string): Promise<GroupInvite | null>;
  /** Returns the group's id */
  joinInvite(token: string): Promise<string>;

  report(target: 'post' | 'comment' | 'profile' | 'message', id: string, reason: string): Promise<void>;
  setBlock(userId: string, on: boolean): Promise<void>;
  isBlocked(userId: string): Promise<boolean>;
}

/** The skills people can pick on their profile and filter by in the directory */
export const SKILLS = [
  'Alight Motion',
  'Typography',
  'Logo animation',
  '2D animation',
  'Product visuals',
  'Transitions',
  'Video editing',
  'Graphic design',
  'AI video',
  'Sound design',
];

/** Black Belt in Motion Design phases, as named on the course page */
export const PHASES = ['Foundations', 'Alight Motion mastery', 'Creative execution', 'Portfolio & mastery'];
