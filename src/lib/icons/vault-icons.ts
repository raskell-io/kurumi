// Vault icons library using Heroicons paths
export interface VaultIcon {
	id: string;
	name: string;
	keywords: string[];
	path: string;
}

export const vaultIcons: VaultIcon[] = [
	// Documents & Notes
	{
		id: 'document',
		name: 'Document',
		keywords: ['file', 'paper', 'note', 'text'],
		path: 'M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z'
	},
	{
		id: 'folder',
		name: 'Folder',
		keywords: ['directory', 'files', 'organize'],
		path: 'M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z'
	},
	{
		id: 'archive',
		name: 'Archive',
		keywords: ['box', 'storage', 'backup'],
		path: 'M4 3a2 2 0 100 4h12a2 2 0 100-4H4zM3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z'
	},
	{
		id: 'book-open',
		name: 'Book',
		keywords: ['read', 'library', 'knowledge', 'study'],
		path: 'M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z'
	},
	{
		id: 'bookmark',
		name: 'Bookmark',
		keywords: ['save', 'favorite', 'mark'],
		path: 'M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z'
	},
	{
		id: 'clipboard',
		name: 'Clipboard',
		keywords: ['paste', 'copy', 'list', 'tasks'],
		path: 'M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1zM6 5a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z'
	},

	// Work & Professional
	{
		id: 'briefcase',
		name: 'Briefcase',
		keywords: ['work', 'job', 'business', 'career', 'professional'],
		path: 'M6 6V5a3 3 0 013-3h2a3 3 0 013 3v1h2a2 2 0 012 2v3.57A22.952 22.952 0 0110 13a22.95 22.95 0 01-8-1.43V8a2 2 0 012-2h2zm2-1a1 1 0 011-1h2a1 1 0 011 1v1H8V5zm1 5a1 1 0 011-1h.01a1 1 0 110 2H10a1 1 0 01-1-1z M2 13.692V16a2 2 0 002 2h12a2 2 0 002-2v-2.308A24.974 24.974 0 0110 15c-2.796 0-5.487-.46-8-1.308z'
	},
	{
		id: 'office',
		name: 'Office',
		keywords: ['building', 'company', 'corporate', 'work'],
		path: 'M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z'
	},
	{
		id: 'presentation',
		name: 'Presentation',
		keywords: ['slides', 'chart', 'meeting', 'pitch'],
		path: 'M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z'
	},

	// Learning & Education
	{
		id: 'academic',
		name: 'Academic',
		keywords: ['education', 'school', 'university', 'graduation', 'learning'],
		path: 'M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0z'
	},
	{
		id: 'pencil',
		name: 'Pencil',
		keywords: ['write', 'edit', 'draw', 'notes'],
		path: 'M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z'
	},
	{
		id: 'puzzle',
		name: 'Puzzle',
		keywords: ['problem', 'solve', 'piece', 'game', 'logic'],
		path: 'M10 3.5a1.5 1.5 0 013 0V4a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-.5a1.5 1.5 0 000 3h.5a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-.5a1.5 1.5 0 00-3 0v.5a1 1 0 01-1 1H6a1 1 0 01-1-1v-3a1 1 0 00-1-1h-.5a1.5 1.5 0 010-3H4a1 1 0 001-1V6a1 1 0 011-1h3a1 1 0 001-1v-.5z'
	},

	// Creative & Design
	{
		id: 'sparkles',
		name: 'Sparkles',
		keywords: ['magic', 'star', 'creative', 'idea', 'ai'],
		path: 'M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z'
	},
	{
		id: 'color-swatch',
		name: 'Color Swatch',
		keywords: ['design', 'palette', 'art', 'creative', 'color'],
		path: 'M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z'
	},
	{
		id: 'camera',
		name: 'Camera',
		keywords: ['photo', 'picture', 'image', 'photography'],
		path: 'M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z'
	},
	{
		id: 'music',
		name: 'Music',
		keywords: ['audio', 'sound', 'song', 'playlist'],
		path: 'M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z'
	},
	{
		id: 'film',
		name: 'Film',
		keywords: ['video', 'movie', 'media', 'cinema'],
		path: 'M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2h6v4H7V5zm8 8v2h1v-2h-1zm-2-2H7v4h6v-4zm2 0h1V9h-1v2zm1-4V5h-1v2h1zM5 5v2H4V5h1zm0 4H4v2h1V9zm-1 4h1v2H4v-2z'
	},

	// Technology & Code
	{
		id: 'code',
		name: 'Code',
		keywords: ['programming', 'developer', 'software', 'tech', 'development'],
		path: 'M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z'
	},
	{
		id: 'terminal',
		name: 'Terminal',
		keywords: ['console', 'command', 'shell', 'cli'],
		path: 'M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 1.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 10 5.293 7.707a1 1 0 010-1.414zM11 12a1 1 0 100 2h3a1 1 0 100-2h-3z'
	},
	{
		id: 'chip',
		name: 'Chip',
		keywords: ['cpu', 'processor', 'hardware', 'computer'],
		path: 'M13 7H7v6h6V7zM5 3a2 2 0 00-2 2v2H2a1 1 0 000 2h1v2H2a1 1 0 000 2h1v2a2 2 0 002 2h2v1a1 1 0 102 0v-1h2v1a1 1 0 102 0v-1h2a2 2 0 002-2v-2h1a1 1 0 100-2h-1V9h1a1 1 0 100-2h-1V5a2 2 0 00-2-2h-2V2a1 1 0 10-2 0v1H9V2a1 1 0 00-2 0v1H5z'
	},
	{
		id: 'database',
		name: 'Database',
		keywords: ['data', 'storage', 'server', 'backend'],
		path: 'M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3zM3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7zM17 5c0 1.657-3.134 3-7 3S3 6.657 3 5s3.134-3 7-3 7 1.343 7 3z'
	},
	{
		id: 'globe',
		name: 'Globe',
		keywords: ['world', 'web', 'internet', 'global', 'earth'],
		path: 'M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z'
	},

	// Personal & Life
	{
		id: 'home',
		name: 'Home',
		keywords: ['house', 'personal', 'private', 'family'],
		path: 'M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z'
	},
	{
		id: 'heart',
		name: 'Heart',
		keywords: ['love', 'favorite', 'like', 'personal'],
		path: 'M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z'
	},
	{
		id: 'star',
		name: 'Star',
		keywords: ['favorite', 'important', 'rating', 'featured'],
		path: 'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z'
	},
	{
		id: 'user',
		name: 'User',
		keywords: ['person', 'profile', 'account', 'personal'],
		path: 'M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z'
	},
	{
		id: 'users',
		name: 'Users',
		keywords: ['team', 'group', 'people', 'community'],
		path: 'M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z'
	},

	// Health & Wellness
	{
		id: 'fitness',
		name: 'Fitness',
		keywords: ['health', 'exercise', 'gym', 'workout', 'lightning'],
		path: 'M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z'
	},
	{
		id: 'sun',
		name: 'Sun',
		keywords: ['day', 'light', 'bright', 'morning', 'energy'],
		path: 'M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z'
	},

	// Finance & Money
	{
		id: 'currency',
		name: 'Currency',
		keywords: ['money', 'finance', 'dollar', 'budget', 'bank'],
		path: 'M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267zM10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z'
	},
	{
		id: 'credit-card',
		name: 'Credit Card',
		keywords: ['payment', 'money', 'bank', 'shopping'],
		path: 'M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z'
	},

	// Time & Calendar
	{
		id: 'calendar',
		name: 'Calendar',
		keywords: ['date', 'schedule', 'event', 'time', 'planner'],
		path: 'M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zM4 8h12v8H4V8z'
	},
	{
		id: 'clock',
		name: 'Clock',
		keywords: ['time', 'schedule', 'hour', 'deadline'],
		path: 'M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z'
	},

	// Location & Travel
	{
		id: 'location',
		name: 'Location',
		keywords: ['map', 'pin', 'place', 'travel', 'address'],
		path: 'M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z'
	},
	{
		id: 'map',
		name: 'Map',
		keywords: ['travel', 'navigation', 'location', 'geography'],
		path: 'M12 1l9 4-9 4-9-4 9-4zm6.89 5.55L12 10.1 5.11 6.55 2 8v11l5-2.22V21l5-2.22L17 21v-4.22L22 19V8l-3.11-1.45z'
	},

	// Communication
	{
		id: 'chat',
		name: 'Chat',
		keywords: ['message', 'conversation', 'communication', 'talk'],
		path: 'M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z'
	},
	{
		id: 'mail',
		name: 'Mail',
		keywords: ['email', 'message', 'inbox', 'letter'],
		path: 'M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884zM18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z'
	},

	// Science & Research
	{
		id: 'beaker',
		name: 'Beaker',
		keywords: ['science', 'lab', 'experiment', 'research', 'chemistry'],
		path: 'M7 2a1 1 0 00-.707 1.707L7 4.414v3.758a1 1 0 01-.293.707l-4 4C.817 14.769 2.156 18 4.828 18h10.343c2.673 0 4.012-3.231 2.122-5.121l-4-4A1 1 0 0113 8.172V4.414l.707-.707A1 1 0 0013 2H7zm2 6.172V4h2v4.172a3 3 0 00.879 2.12l1.027 1.028a4 4 0 00-2.171.102l-.47.156a4 4 0 01-2.53 0l-.563-.187a1.993 1.993 0 00-.114-.035l1.063-1.063A3 3 0 009 8.172z'
	},
	{
		id: 'lightbulb',
		name: 'Lightbulb',
		keywords: ['idea', 'inspiration', 'think', 'innovation'],
		path: 'M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z'
	},

	// Nature
	{
		id: 'fire',
		name: 'Fire',
		keywords: ['hot', 'flame', 'trending', 'popular'],
		path: 'M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z'
	},
	{
		id: 'leaf',
		name: 'Leaf',
		keywords: ['nature', 'plant', 'eco', 'green', 'organic'],
		path: 'M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM3.879 8.707A3 3 0 016 12h.17a3 3 0 002.83-4l-.17-.83h6.34l-.17.83A3 3 0 0017.83 12H18a3 3 0 002.12-.879l.707-.707A1 1 0 0019.414 9H.586a1 1 0 00-1.414 1.414l.707.707zM2 17v-3h16v3a2 2 0 01-2 2H4a2 2 0 01-2-2z'
	},

	// Security & Privacy
	{
		id: 'lock',
		name: 'Lock',
		keywords: ['security', 'private', 'password', 'protected'],
		path: 'M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z'
	},
	{
		id: 'shield',
		name: 'Shield',
		keywords: ['security', 'protection', 'safe', 'guard'],
		path: 'M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z'
	},
	{
		id: 'key',
		name: 'Key',
		keywords: ['access', 'password', 'unlock', 'secret'],
		path: 'M8 11a3 3 0 100-6 3 3 0 000 6zM14.828 14.828a4 4 0 01-5.656 0l-.707-.707A6.001 6.001 0 012 9.172 6 6 0 018 3a6 6 0 015.172 2.965l4.95 4.95a1 1 0 010 1.414l-2.122 2.121a1 1 0 01-1.414 0l-.707-.707a1 1 0 010-1.414l.707-.707-1.414-1.414-.707.707a1 1 0 01-1.414 0l-.707-.707-.707.707a4 4 0 01.707 4.95z'
	},

	// Miscellaneous
	{
		id: 'tag',
		name: 'Tag',
		keywords: ['label', 'category', 'price', 'mark'],
		path: 'M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z'
	},
	{
		id: 'flag',
		name: 'Flag',
		keywords: ['mark', 'important', 'report', 'priority'],
		path: 'M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z'
	},
	{
		id: 'cube',
		name: 'Cube',
		keywords: ['3d', 'box', 'package', 'product'],
		path: 'M10 3.5a1.5 1.5 0 013 0V4a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-.5a1.5 1.5 0 000 3h.5a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-.5a1.5 1.5 0 00-3 0v.5a1 1 0 01-1 1H6a1 1 0 01-1-1v-3a1 1 0 00-1-1h-.5a1.5 1.5 0 010-3H4a1 1 0 001-1V6a1 1 0 011-1h3a1 1 0 001-1v-.5z'
	},
	{
		id: 'gift',
		name: 'Gift',
		keywords: ['present', 'surprise', 'reward', 'bonus'],
		path: 'M5 5a3 3 0 015-2.236A3 3 0 0114.83 6H16a2 2 0 012 2v3a1 1 0 01-1 1h-.17a3 3 0 01-2.83 4H6a3 3 0 01-2.83-4H3a1 1 0 01-1-1V8a2 2 0 012-2h1.17A3 3 0 015 5zm5-1a1 1 0 10-2 0v1h2V4zm-2 4v6h4V8H8zm6 0h2v2h-2V8zM4 8v2h2V8H4zm2 4H4v2a1 1 0 001 1h1v-3zm8 0v3h1a1 1 0 001-1v-2h-2z'
	},
	{
		id: 'cog',
		name: 'Settings',
		keywords: ['gear', 'config', 'preferences', 'options'],
		path: 'M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z'
	}
];

// Search icons by name or keywords
export function searchIcons(query: string): VaultIcon[] {
	if (!query.trim()) return vaultIcons;
	const q = query.toLowerCase().trim();
	return vaultIcons.filter(
		(icon) =>
			icon.name.toLowerCase().includes(q) ||
			icon.keywords.some((kw) => kw.toLowerCase().includes(q))
	);
}

// Get icon by ID
export function getIconById(id: string): VaultIcon | undefined {
	return vaultIcons.find((icon) => icon.id === id);
}
