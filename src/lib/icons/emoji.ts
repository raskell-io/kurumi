// Curated emoji for page icons, grouped for the picker. Each entry is
// "emoji keywords…" so search can match on names. Anything not listed can
// still be pasted or typed into the picker's search box.

export interface EmojiGroup {
	name: string;
	items: { emoji: string; keywords: string }[];
}

const RAW: Record<string, string[]> = {
	Work: [
		'📝 memo note write',
		'📄 page document',
		'📋 clipboard list',
		'📌 pin pushpin',
		'📎 paperclip attach',
		'🗂️ dividers index folder',
		'📁 folder',
		'🗃️ card box archive',
		'📊 chart bar stats',
		'📈 chart up growth',
		'📉 chart down decline',
		'🗓️ calendar date schedule',
		'⏰ alarm clock deadline',
		'⏳ hourglass waiting',
		'✅ check done task',
		'☑️ checkbox todo',
		'🎯 target goal okr',
		'🚀 rocket launch ship',
		'💼 briefcase work job',
		'🏢 office building company',
		'🤝 handshake deal partner',
		'👥 people team',
		'🧑‍💻 developer coder',
		'📣 megaphone announce',
		'📬 mailbox inbox',
		'✉️ envelope email',
		'📞 phone call',
		'💬 speech chat comment',
		'🗣️ speaking talk meeting',
		'🧾 receipt invoice',
		'💰 money budget',
		'💳 card payment',
		'⚖️ scales legal balance',
		'🔒 lock secure private',
		'🔑 key access',
		'🛠️ tools build fix',
		'⚙️ gear settings config',
		'🧪 test experiment lab',
		'🐛 bug issue',
		'🔥 fire hot urgent',
		'⚠️ warning risk',
		'❗ important exclamation',
		'❓ question',
		'💡 idea bulb insight',
		'🧠 brain think',
		'📚 books library learn',
		'📖 book read',
		'🔖 bookmark',
		'🏷️ label tag',
		'🔍 search magnify research',
		'🧭 compass direction strategy',
		'🗺️ map plan roadmap',
		'🏁 finish flag milestone',
		'🎉 party celebrate launch'
	],
	Objects: [
		'💻 laptop computer',
		'🖥️ desktop monitor',
		'📱 phone mobile',
		'⌨️ keyboard',
		'🖨️ printer',
		'💾 floppy save',
		'🎧 headphones audio',
		'🎙️ microphone podcast record',
		'📷 camera photo',
		'🎬 film movie video',
		'🎨 palette art design',
		'✏️ pencil edit draft',
		'🖊️ pen sign',
		'📐 ruler design',
		'🧩 puzzle piece',
		'🔧 wrench',
		'🔨 hammer',
		'🧰 toolbox',
		'📦 package box shipping',
		'🛒 cart shopping',
		'🎁 gift present',
		'🏠 house home',
		'🏡 home garden',
		'✈️ plane travel trip',
		'🚗 car drive',
		'🚲 bike',
		'🌍 globe world earth',
		'🧳 luggage travel'
	],
	Nature: [
		'🌱 seedling grow start',
		'🌿 herb leaf',
		'🌳 tree',
		'🌸 blossom flower',
		'🌻 sunflower',
		'🍀 clover luck',
		'🍂 autumn leaves',
		'🌊 wave ocean',
		'⛰️ mountain',
		'🌙 moon night',
		'☀️ sun day',
		'⭐ star favorite',
		'✨ sparkles magic new',
		'🌈 rainbow',
		'❄️ snow winter',
		'⚡ lightning fast energy',
		'🐱 cat',
		'🐶 dog',
		'🦊 fox',
		'🐝 bee busy',
		'🦉 owl wisdom',
		'🐢 turtle slow',
		'🌰 chestnut walnut kurumi'
	],
	Life: [
		'❤️ heart love',
		'💪 strong fitness',
		'🏃 run exercise',
		'🧘 yoga meditate calm',
		'😴 sleep rest',
		'🍎 apple food health',
		'☕ coffee break',
		'🍳 cooking recipe',
		'🍽️ dinner meal',
		'🎵 music note',
		'🎮 game play',
		'⚽ soccer sport',
		'🎓 graduation school study',
		'💊 pill medicine health',
		'👶 baby family',
		'👪 family',
		'🙂 smile happy',
		'😎 cool',
		'🤔 thinking',
		'🙏 thanks gratitude',
		'👋 hello wave',
		'👀 eyes look review'
	],
	Symbols: [
		'🔴 red circle',
		'🟠 orange circle',
		'🟡 yellow circle',
		'🟢 green circle',
		'🔵 blue circle',
		'🟣 purple circle',
		'⚫ black circle',
		'⚪ white circle',
		'🟥 red square',
		'🟩 green square',
		'🟦 blue square',
		'🔶 orange diamond',
		'🔷 blue diamond',
		'➡️ arrow right next',
		'🔁 repeat recurring',
		'♻️ recycle',
		'🆕 new',
		'🆗 ok',
		'💯 hundred perfect',
		'#️⃣ hash number',
		'Ⓜ️ m circle',
		'🔔 bell reminder notification',
		'🚩 flag red',
		'🛑 stop',
		'⛔ no entry blocked'
	]
};

export const emojiGroups: EmojiGroup[] = Object.entries(RAW).map(([name, entries]) => ({
	name,
	items: entries.map((entry) => {
		const space = entry.indexOf(' ');
		return { emoji: entry.slice(0, space), keywords: entry.slice(space + 1) };
	})
}));

const allEmoji = emojiGroups.flatMap((g) => g.items);

export function searchEmoji(query: string): { emoji: string; keywords: string }[] {
	const q = query.trim().toLowerCase();
	if (!q) return allEmoji;
	return allEmoji.filter((e) => e.keywords.split(' ').some((word) => word.startsWith(q)));
}

export function randomEmoji(): string {
	return allEmoji[Math.floor(Math.random() * allEmoji.length)].emoji;
}

/** True when the string is (only) emoji, e.g. something the user pasted. */
export function isEmoji(value: string): boolean {
	const trimmed = value.trim();
	return trimmed.length > 0 && trimmed.length <= 16 && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️)+$/u.test(trimmed);
}
