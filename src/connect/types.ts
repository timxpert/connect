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
  /** Preview only: marks invented sample data */
  sample?: boolean;
};

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
  kind: 'community_post' | 'connection_request' | 'connection_accepted';
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

export type MessageKind = 'text' | 'voice' | 'image' | 'video' | 'file';

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
  /** Client only: still uploading / sending */
  pending?: boolean;
  progress?: number;
  failed?: boolean;
};

export type Attachment = { file: File; kind: Exclude<MessageKind, 'text'>; duration?: number; thumb?: string };

export type ProfileInput = Partial<
  Pick<Profile, 'handle' | 'name' | 'bio' | 'avatar_url' | 'cover_url' | 'country' | 'skills' | 'phase' | 'phase_public' | 'instagram' | 'youtube' | 'website' | 'links'>
>;

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
  subscribe(table: 'messages' | 'comments' | 'notifications', filter: string, cb: (change: { event: string; row: Record<string, unknown> }) => void): () => void;
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
  addComment(postId: string, body: string): Promise<Comment>;
  deleteComment(id: string): Promise<void>;

  listConversations(): Promise<Conversation[]>;
  openConversation(userId: string): Promise<string>;
  getConversation(id: string): Promise<Conversation | null>;
  listMessages(conversationId: string): Promise<Message[]>;
  sendMessage(conversationId: string, body: string): Promise<Message>;
  /** Voice note, photo, video or file. Uploads privately, then sends. */
  sendAttachment(conversationId: string, a: Attachment, caption: string, onProgress?: (share: number) => void): Promise<Message>;
  deleteMessage(id: string): Promise<void>;
  /** Marks everything the other person sent in this chat as seen */
  markRead(conversationId: string): Promise<void>;
  /** Marks all incoming messages as delivered to this device */
  markDelivered(): Promise<void>;

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
