import {
    session, getTagIndex, ensureTag, addVideo, getVideos,
    updateVideoField, deleteVideo, getGroupVisibilities, saveGroupVisibility,
    getPublicGroups, getPublicProfile, showError
} from "./firebase-data.js";

const status = document.getElementById("status");
const value = (id) => document.getElementById(id).value.trim();
let indexedTags = [];
let videoSearchIndex = { tag: [], group: [] };
let groupEntries = [];
let selectedGroupKey = null;
let groupVisibilities = new Map();
let activePlaylist = [];
let activePlaylistIndex = -1;
let activePlaylistReadOnly = false;
let currentProviderPlayer = null;
let youtubeApiPromise = null;
let vimeoApiPromise = null;
let publicGroups = [];
let publicGroupsLoaded = false;
let currentPublicGroup = null;

document.getElementById("showCollectionPage").addEventListener("click", () => navigateTo("#/collection"));
document.getElementById("showExplorePage").addEventListener("click", () => navigateTo("#/explore"));
document.getElementById("showUserSettingsPage").addEventListener("click", () => navigateTo("#/settings"));
document.getElementById("backToExplore").addEventListener("click", () => {
    if (currentPublicGroup?.owner?.username) navigateTo(userRoute(currentPublicGroup.owner.username));
    else navigateTo("#/explore");
});
document.getElementById("backToExploreFromProfile").addEventListener("click", () => navigateTo("#/explore"));
window.addEventListener("hashchange", () => { routeFromHash().catch(showError); });

document.getElementById("addVideoButton").addEventListener("click", () => document.getElementById("addVideoDialog").showModal());
document.getElementById("cancelAddVideo").addEventListener("click", () => document.getElementById("addVideoDialog").close());
document.getElementById("backToGroups").addEventListener("click", showGroups);
document.getElementById("previousPlaylistItem").addEventListener("click", () => moveInPlaylist(-1));
document.getElementById("nextPlaylistItem").addEventListener("click", () => moveInPlaylist(1));
document.getElementById("videoType").addEventListener("change", updateItemTypeLabels);
updateItemTypeLabels();

function updateItemTypeLabels() {
    const type = value("videoType");
    document.getElementById("videoLinkLabel").firstChild.textContent =
        type === "image" ? "Image URL " : type === "file" ? "File or archive URL " : "Video link ";
    document.getElementById("videoLink").placeholder = type === "image" ? "https://example.com/image.jpg" :
        type === "file" ? "https://drive.google.com/file/d/..." : "https://www.youtube.com/watch?v=...";
}

function showCollectionPage() {
    setVisiblePage("collectionPage");
}

async function showExplorePage(reload) {
    setVisiblePage("explorePage");
    if (reload && session.username) {
        const display = document.getElementById("exploreGroups");
        display.replaceChildren();
        const loading = document.createElement("p");
        loading.textContent = "Loading public groups…";
        display.appendChild(loading);
        try {
            publicGroups = await getPublicGroups();
            publicGroupsLoaded = true;
            renderExploreGroups();
        } catch (error) { showError(error); }
    }
}

function setVisiblePage(pageId) {
    ["collectionPage", "userSettingsPage", "explorePage", "publicGroupPage", "publicProfilePage"].forEach((id) => {
        document.getElementById(id).hidden = id !== pageId;
    });
}

function userRoute(username, collection = "") {
    const route = `#/user/${encodeURIComponent(username)}`;
    return collection ? `${route}?collection=${encodeURIComponent(collection)}` : route;
}

function navigateTo(route) {
    if (location.hash === route) routeFromHash().catch(showError);
    else location.hash = route;
}

async function routeFromHash() {
    if (!session.username) return;
    const raw = location.hash || "#/collection";
    const [path, queryString = ""] = raw.slice(1).split("?");
    if (path === "/explore") return showExplorePage(true);
    if (path === "/settings") return setVisiblePage("userSettingsPage");
    if (path === "/collection" || !path || path === "/") return showCollectionPage();
    const match = path.match(/^\/user\/([^/]+)$/);
    if (match) {
        const username = decodeURIComponent(match[1]);
        const params = new URLSearchParams(queryString);
        const collection = params.get("collection");
        if (!publicGroupsLoaded) {
            publicGroups = await getPublicGroups();
            publicGroupsLoaded = true;
        }
        const profile = await getPublicProfile(username);
        if (!profile) {
            status.textContent = "This profile is no longer available.";
            return showExplorePage(false);
        }
        if (collection) {
            const group = publicGroups.find((item) => item.ownerId === profile.userId && item.groupID.toLowerCase() === collection.toLowerCase());
            if (group) return renderPublicGroup(group);
        }
        return renderPublicProfile(profile);
    }
    showCollectionPage();
}

function makeOwnerHeader(owner) {
    const header = document.createElement("div");
    header.className = "public-owner";
    if (owner.profileImageURL && isHttpLink(owner.profileImageURL)) {
        const image = document.createElement("img");
        image.className = "public-owner-image";
        image.src = owner.profileImageURL;
        image.alt = "";
        image.onerror = () => image.remove();
        header.appendChild(image);
    }
    const username = document.createElement("button");
    username.type = "button";
    username.className = "public-owner-link";
    username.textContent = owner.username;
    username.addEventListener("click", () => openPublicProfile(owner.username));
    header.appendChild(username);
    return header;
}

function publicItemType(item) {
    if (isDriveLink(item.link)) return "file";
    return ["video", "image", "file"].includes(item.type) ? item.type : "video";
}

function publicItemThumbnail(item) {
    const type = publicItemType(item);
    return safeThumbnailURL(item.thumbnailURL) || (type === "image" ? item.link : getAutomaticThumbnailURL(item.link));
}

function renderExploreGroups() {
    const display = document.getElementById("exploreGroups");
    display.replaceChildren();
    if (!publicGroups.length) {
        const empty = document.createElement("p");
        empty.textContent = "There are no public groups yet.";
        display.appendChild(empty);
        return;
    }
    publicGroups.forEach((group) => display.appendChild(createPublicGroupCard(group)));
}

function createPublicGroupCard(group) {
    const card = document.createElement("article");
    card.className = "public-group-card";
    card.appendChild(makeOwnerHeader(group.owner));
    const open = document.createElement("button");
    open.type = "button";
    open.className = "public-group-open";
    open.addEventListener("click", () => navigateTo(userRoute(group.owner.username, group.groupID)));
    const mosaic = document.createElement("span");
    mosaic.className = "group-mosaic";
    group.items.map(publicItemThumbnail).filter(Boolean).slice(0, 3).forEach((url) => {
        const image = document.createElement("img");
        image.src = url;
        image.alt = "";
        image.loading = "lazy";
        mosaic.appendChild(image);
    });
    if (!mosaic.childElementCount) {
        const placeholder = document.createElement("span");
        placeholder.className = "group-mosaic-placeholder";
        placeholder.textContent = "No thumbnails";
        mosaic.appendChild(placeholder);
    }
    const title = document.createElement("strong");
    title.textContent = group.groupID;
    const count = document.createElement("small");
    count.textContent = `${group.items.length} item${group.items.length === 1 ? "" : "s"}`;
    open.append(mosaic, title, count);
    card.appendChild(open);
    return card;
}
function renderPublicGroup(group) {
    currentPublicGroup = group;
    setVisiblePage("publicGroupPage");
    document.getElementById("backToExplore").textContent = `← @${group.owner.username}`;
    document.getElementById("publicGroupOwner").replaceChildren(makeOwnerHeader(group.owner));
    document.getElementById("publicGroupTitle").textContent = group.groupID;
    const list = document.getElementById("publicGroupItems");
    list.replaceChildren();
    const playlist = group.items.map((item) => ({
        ...item,
        itemType: publicItemType(item),
        tags: Array.isArray(item.tags) ? item.tags : [],
        groupIDs: Array.isArray(item.groupIDs) ? item.groupIDs : [],
        thumbnail: publicItemThumbnail(item)
    }));
    playlist.forEach((item, index) => {
        const card = document.createElement("article");
        card.className = "public-item-card";
        const thumb = publicItemThumbnail(item);
        if (thumb) {
            const image = document.createElement("img");
            image.src = thumb;
            image.alt = "";
            image.loading = "lazy";
            const open = document.createElement("button");
            open.type = "button";
            open.className = "public-item-open";
            open.setAttribute("aria-label", `Open ${item.description || item.itemType}`);
            open.appendChild(image);
            open.addEventListener("click", () => openPublicPlaylist(playlist, index));
            card.appendChild(open);
        } else {
            const open = document.createElement("button");
            open.type = "button";
            open.className = "public-item-open public-item-placeholder";
            open.textContent = item.itemType === "file" ? "FILE" : item.itemType === "image" ? "IMAGE" : "PLAY VIDEO";
            open.addEventListener("click", () => openPublicPlaylist(playlist, index));
            card.appendChild(open);
        }
        const type = document.createElement("small");
        type.textContent = publicItemType(item);
        const description = document.createElement("p");
        description.textContent = item.description || "No description added.";
        card.append(type, description);
        list.appendChild(card);
    });
}

function openPublicPlaylist(items, index) {
    const item = items[index];
    if (item) openVideoPlayer(item, items, true);
}

async function openPublicProfile(username) {
    navigateTo(userRoute(username));
}

function renderPublicProfile(profile) {
    setVisiblePage("publicProfilePage");
    document.getElementById("backToExploreFromProfile").textContent = "← Explore";
    const content = document.getElementById("publicProfileContent");
    content.replaceChildren();
    if (profile.profileImageURL && isHttpLink(profile.profileImageURL)) {
        const image = document.createElement("img");
        image.className = "public-owner-image";
        image.src = profile.profileImageURL;
        image.alt = `${profile.username}'s profile`;
        image.onerror = () => image.remove();
        content.appendChild(image);
    }
    const name = document.createElement("h2");
    name.textContent = profile.username;
    const description = document.createElement("p");
    description.textContent = profile.description || "No description added.";
    content.append(name, description);
    const collectionsHeading = document.createElement("h3");
    collectionsHeading.textContent = "Public collections";
    const collections = document.createElement("div");
    collections.className = "explore-grid";
    const userGroups = publicGroups.filter((group) => group.ownerId === profile.userId);
    if (userGroups.length) userGroups.forEach((group) => collections.appendChild(createPublicGroupCard(group)));
    else {
        const empty = document.createElement("p");
        empty.textContent = "This user has no public collections.";
        collections.appendChild(empty);
    }
    content.append(collectionsHeading, collections);
}


document.getElementById("addVideoForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!session.userId || !session.username) { status.textContent = "Sign in before saving a video."; return; }
    try {
        const tags = parseTags(value("videoTags"));
        const groupIDs = parseTags(value("videoGroups"));
        const result = await addVideo({
            type: value("videoType"),
            link: value("videoLink"), description: value("videoDescription"),
            thumbnailURL: value("videoThumbnail"), tags, groupIDs
        });
        result.tagChecks.forEach(({ tag }) => {
            if (tag && !indexedTags.some((indexed) => indexed.toLowerCase() === tag.toLowerCase())) indexedTags.push(tag);
        });
        refreshTagSuggestions();
        const existingTags = result.tagChecks.filter((item) => item.exists).map((item) => item.tag);
        const newTags = result.tagChecks.filter((item) => !item.exists).map((item) => item.tag);
        document.getElementById("tagIndexStatus").textContent = [
            existingTags.length ? `Already indexed: ${existingTags.join(", ")}` : "",
            newTags.length ? `Added to tag index: ${newTags.join(", ")}` : ""
        ].filter(Boolean).join(". ");
        document.getElementById("addVideoForm").reset();
        updateItemTypeLabels();
        document.getElementById("addVideoDialog").close();
        selectedGroupKey = null;
        await loadVideos();
        status.textContent = "Saved video to your collection.";
    } catch (error) { showError(error); }
});

function parseTags(text) {
    return [...new Map(text.split(",").map((tag) => tag.trim()).filter(Boolean)
        .map((tag) => [tag.toLowerCase(), tag])).values()];
}

async function loadTagSuggestions() {
    indexedTags = await getTagIndex();
    refreshTagSuggestions();
}

function refreshTagSuggestions() {
    const input = document.getElementById("videoTags");
    const suggestions = document.getElementById("tagEntrySuggestions");
    if (!input || !suggestions) return;
    const { start, end, token } = currentTagToken(input);
    const current = token.trim().toLowerCase();
    suggestions.replaceChildren();
    if (!current) {
        hideTagSuggestions();
        return;
    }
    const activeTokenIndex = input.value.slice(0, start).split(",").length - 1;
    const existingTags = input.value.split(",").filter((_, index) => index !== activeTokenIndex)
        .map((tag) => tag.trim().toLowerCase());
    const matches = indexedTags.filter((tag) => tag.toLowerCase().startsWith(current) && !existingTags.includes(tag.toLowerCase())).slice(0, 12);
    matches.forEach((tag, index) => {
        const row = document.createElement("li");
        row.setAttribute("role", "option");
        const choice = document.createElement("button");
        choice.type = "button";
        choice.textContent = tag;
        choice.setAttribute("aria-selected", String(index === 0));
        choice.addEventListener("mousedown", (event) => event.preventDefault());
        choice.addEventListener("click", () => {
            const replaceStart = start + (token.match(/^\s*/)?.[0].length ?? 0);
            input.value = `${input.value.slice(0, replaceStart)}${tag}${input.value.slice(end)}`;
            const caret = replaceStart + tag.length;
            input.focus();
            input.setSelectionRange(caret, caret);
            hideTagSuggestions();
        });
        row.appendChild(choice);
        suggestions.appendChild(row);
    });
    suggestions.hidden = matches.length === 0;
    input.setAttribute("aria-expanded", String(matches.length > 0));
}

function currentTagToken(input) {
    const caret = input.selectionStart ?? input.value.length;
    const start = input.value.lastIndexOf(",", caret - 1) + 1;
    const nextComma = input.value.indexOf(",", caret);
    const end = nextComma === -1 ? input.value.length : nextComma;
    return { start, end, token: input.value.slice(start, end) };
}

function hideTagSuggestions() {
    const suggestions = document.getElementById("tagEntrySuggestions");
    if (suggestions) suggestions.hidden = true;
    document.getElementById("videoTags")?.setAttribute("aria-expanded", "false");
}

const videoTagsInput = document.getElementById("videoTags");
videoTagsInput.addEventListener("input", refreshTagSuggestions);
videoTagsInput.addEventListener("click", refreshTagSuggestions);
videoTagsInput.addEventListener("keyup", refreshTagSuggestions);
videoTagsInput.addEventListener("focus", refreshTagSuggestions);
videoTagsInput.addEventListener("blur", (event) => {
    if (event.relatedTarget?.closest("#tagEntrySuggestions")) return;
    setTimeout(hideTagSuggestions, 120);
});
videoTagsInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
        const firstSuggestion = document.querySelector("#tagEntrySuggestions button");
        if (firstSuggestion) {
            event.preventDefault();
            firstSuggestion.focus();
        }
    } else if (event.key === "Escape") hideTagSuggestions();
    else if (event.key === "Enter" && !document.getElementById("tagEntrySuggestions").hidden) {
        const firstSuggestion = document.querySelector("#tagEntrySuggestions button");
        if (firstSuggestion) {
            event.preventDefault();
            firstSuggestion.click();
        }
    }
});

document.getElementById("tagFilter").addEventListener("input", () => {
    renderSearchResults("tag");
    applyBrowseFilters();
});
document.getElementById("groupFilter").addEventListener("input", () => {
    renderSearchResults("group");
    applyBrowseFilters();
});

function renderSearchResults(kind) {
    const isTag = kind === "tag";
    const input = document.getElementById(isTag ? "tagFilter" : "groupFilter");
    const list = document.getElementById(isTag ? "tagSearchResults" : "groupSearchResults");
    const term = input.value.trim().toLowerCase();
    list.replaceChildren();
    if (!term) { list.hidden = true; return; }
    const matches = videoSearchIndex[kind].filter((item) => item.label.toLowerCase().includes(term)).slice(0, 30);
    matches.forEach((item) => {
        const row = document.createElement("li");
        const choice = document.createElement("button");
        choice.type = "button";
        const label = document.createElement("span");
        label.textContent = item.label;
        const count = document.createElement("small");
        count.textContent = `${item.count} item${item.count === 1 ? "" : "s"}`;
        choice.append(label, count);
        choice.addEventListener("click", () => {
            input.value = item.label;
            list.hidden = true;
            applyBrowseFilters();
        });
        row.appendChild(choice);
        list.appendChild(row);
    });
    if (!matches.length) {
        const empty = document.createElement("li");
        empty.textContent = `No matching ${isTag ? "tags" : "groups"}.`;
        empty.style.padding = ".55rem .65rem";
        list.appendChild(empty);
    }
    list.hidden = false;
}

function applyBrowseFilters() {
    const tagTerm = value("tagFilter").toLowerCase();
    const groupTerm = value("groupFilter").toLowerCase();
    if (selectedGroupKey === null) {
        const visible = groupEntries.filter((entry) => entry.label.toLowerCase().includes(groupTerm) &&
            (!tagTerm || entry.cards.some((video) => video.tags.some((tag) => tag.toLowerCase().includes(tagTerm)))));
        document.querySelectorAll(".group-card").forEach((card) => {
            card.hidden = !visible.some((entry) => entry.key === card.dataset.groupKey);
        });
        document.getElementById("videoSearchSummary").textContent = `${visible.length} of ${groupEntries.length} group${groupEntries.length === 1 ? "" : "s"}`;
        return;
    }
    const cards = [...document.getElementById("videoDisplay").querySelectorAll(".video-card")];
    let visibleCount = 0;
    cards.forEach((card) => {
        const tags = JSON.parse(card.dataset.tags || "[]");
        const groups = JSON.parse(card.dataset.groups || "[]");
        const groupMatch = !groupTerm || (selectedGroupKey === "ungrouped"
            ? "ungrouped".includes(groupTerm)
            : groups.some((group) => group.includes(groupTerm)));
        card.hidden = (tagTerm && !tags.some((tag) => tag.includes(tagTerm))) || !groupMatch;
        if (!card.hidden) visibleCount++;
    });
    document.getElementById("videoSearchSummary").textContent = `${visibleCount} of ${cards.length} item${cards.length === 1 ? "" : "s"}`;
}

function openGroup(key) {
    const entry = groupEntries.find((item) => item.key === key);
    if (!entry) return;
    selectedGroupKey = key;
    activePlaylist = entry.cards;
    document.getElementById("activeGroupTitle").textContent = entry.label;
    document.getElementById("groupDisplay").hidden = true;
    document.getElementById("videoView").hidden = false;
    document.getElementById("videoDisplay").replaceChildren(...entry.cards.map((item) => item.element));
    applyBrowseFilters();
}

function showGroups() {
    selectedGroupKey = null;
    document.getElementById("videoView").hidden = true;
    document.getElementById("groupDisplay").hidden = false;
    document.getElementById("videoDisplay").replaceChildren();
    applyBrowseFilters();
}

function renderGroupCards() {
    const display = document.getElementById("groupDisplay");
    display.replaceChildren();
    groupEntries.forEach((entry) => {
        const card = document.createElement("article");
        card.className = "group-card";
        card.dataset.groupKey = entry.key;
        const openButton = document.createElement("button");
        openButton.type = "button";
        openButton.className = "group-open-button";
        openButton.addEventListener("click", () => openGroup(entry.key));
        const mosaic = document.createElement("span");
        mosaic.className = "group-mosaic";
        const images = entry.cards.map((video) => video.thumbnail).filter(Boolean).slice(0, 3);
        if (images.length) images.forEach((url) => {
            const image = document.createElement("img");
            image.src = url;
            image.alt = "";
            mosaic.appendChild(image);
        });
        else {
            const placeholder = document.createElement("span");
            placeholder.className = "group-mosaic-placeholder";
            placeholder.textContent = "No thumbnails";
            mosaic.appendChild(placeholder);
        }
        const title = document.createElement("strong");
        title.textContent = entry.label;
        const count = document.createElement("small");
        count.textContent = `${entry.cards.length} item${entry.cards.length === 1 ? "" : "s"}`;
        openButton.append(mosaic, title, count);

        const settings = document.createElement("div");
        settings.className = "group-visibility-controls";
        const visibilityLabel = document.createElement("label");
        visibilityLabel.append(document.createTextNode("Visibility "));
        const visibility = document.createElement("select");
        visibility.id = `group-visibility-${encodeURIComponent(entry.key)}`;
        visibility.name = "groupVisibility";
        visibility.setAttribute("aria-label", `Visibility for ${entry.label}`);
        visibility.add(new Option("Private", "private"));
        visibility.add(new Option("Public", "public"));
        visibility.value = groupVisibilities.get(entry.label.trim().toLowerCase()) || "private";
        const save = document.createElement("button");
        save.type = "button";
        save.textContent = "Save visibility";
        save.addEventListener("click", async () => {
            try {
                await saveGroupVisibility(entry.label, visibility.value);
                groupVisibilities.set(entry.label.trim().toLowerCase(), visibility.value);
                status.textContent = `Saved ${entry.label} as ${visibility.value}.`;
            } catch (error) { showError(error); }
        });
        visibilityLabel.appendChild(visibility);
        settings.append(visibilityLabel, save);
        card.append(openButton, settings);
        display.appendChild(card);
    });
}

async function loadVideos() {
    document.getElementById("videoDisplay").replaceChildren();
    document.getElementById("groupDisplay").replaceChildren();
    if (!session.userId || !session.username) return;
    const [videos, savedVisibilities] = await Promise.all([getVideos(), getGroupVisibilities()]);
    groupVisibilities = savedVisibilities;
    const availableTags = new Map();
    const availableGroups = new Map();
    const rendered = videos.filter((video) => isHttpLink(video.link)).map((video) => {
        const savedType = ["video", "image", "file"].includes(video.type) ? video.type : "video";
        const itemType = isDriveLink(video.link) ? "file" : savedType;
        const tags = Array.isArray(video.tags) ? video.tags.filter((tag) => typeof tag === "string" && tag.trim()) : [];
        const groupIDs = Array.isArray(video.groupIDs) ? video.groupIDs.filter((group) => typeof group === "string" && group.trim()) : [];
        tags.forEach((tag) => {
            const key = tag.trim().toLowerCase();
            if (!availableTags.has(key)) availableTags.set(key, { label: tag.trim(), count: 0 });
            availableTags.get(key).count++;
        });
        groupIDs.forEach((group) => {
            const key = group.trim().toLowerCase();
            if (!availableGroups.has(key)) availableGroups.set(key, { label: group.trim(), count: 0 });
            availableGroups.get(key).count++;
        });
        const thumbnail = safeThumbnailURL(video.thumbnailURL) || (itemType === "image" ? video.link : getAutomaticThumbnailURL(video.link));
        const item = { ...video, itemType, tags, groupIDs, thumbnail };
        item.element = createVideoCard(item);
        return item;
    });

    videoSearchIndex = {
        tag: [...availableTags.values()].sort((a, b) => a.label.localeCompare(b.label)),
        group: [...availableGroups.values(), ...(rendered.some((video) => !video.groupIDs.length)
            ? [{ label: "Ungrouped", count: rendered.filter((video) => !video.groupIDs.length).length }] : [])]
            .sort((a, b) => a.label.localeCompare(b.label))
    };
    renderSearchResults("tag");
    renderSearchResults("group");

    const groups = new Map([["ungrouped", { key: "ungrouped", label: "Ungrouped", cards: [] }]]);
    rendered.forEach((video) => {
        if (!video.groupIDs.length) groups.get("ungrouped").cards.push(video);
        else video.groupIDs.forEach((label) => {
            const key = `group:${label.trim().toLowerCase()}`;
            if (!groups.has(key)) groups.set(key, { key, label, cards: [] });
            groups.get(key).cards.push(video);
        });
    });
    groupEntries = [...groups.values()].sort((a, b) => a.key === "ungrouped" ? 1 : b.key === "ungrouped" ? -1 : a.label.localeCompare(b.label));
    renderGroupCards();
    if (selectedGroupKey && groupEntries.some((entry) => entry.key === selectedGroupKey)) openGroup(selectedGroupKey);
    else showGroups();
}

function createVideoCard(video) {
    const card = document.createElement("article");
    card.className = "video-card";
    card.dataset.videoId = video.id;
    card.dataset.videoLink = video.link;
    card.dataset.description = video.description || "Saved item";
    card.dataset.itemType = video.itemType;
    card.dataset.tags = JSON.stringify(video.tags.map((tag) => tag.trim().toLowerCase()));
    card.dataset.groups = JSON.stringify(video.groupIDs.map((group) => group.trim().toLowerCase()));
    card.dataset.tagLabels = JSON.stringify(video.tags);
    card.dataset.groupLabels = JSON.stringify(video.groupIDs);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "video-delete";
    remove.textContent = "×";
    remove.dataset.action = "video-delete";
    remove.setAttribute("aria-label", "Remove saved video");
    const thumbnail = document.createElement("button");
    thumbnail.type = "button";
    thumbnail.className = "video-thumb-button";
    thumbnail.dataset.action = "play-video";
    thumbnail.setAttribute("aria-label", `${video.itemType === "image" ? "View" : video.itemType === "file" ? "Open" : "Play"} ${video.description || "saved item"}`);
    if (video.thumbnail) {
        const image = document.createElement("img");
        image.src = video.thumbnail;
        image.alt = "";
        image.loading = "lazy";
        thumbnail.appendChild(image);
    } else {
        const fallback = document.createElement("span");
        fallback.className = "video-placeholder";
        fallback.textContent = video.itemType === "file" ? "Open file or archive" :
            video.itemType === "image" ? "View image" : "Click to play video";
        thumbnail.appendChild(fallback);
    }
    const description = document.createElement("p");
    description.className = "video-description";
    description.textContent = video.description || "No notes added.";
    const tags = document.createElement("div");
    tags.className = "video-tags";
    video.tags.forEach((tag) => tags.appendChild(createDisplayBadge(tag, "video-tag")));
    const groups = document.createElement("div");
    groups.className = "video-groups";
    video.groupIDs.forEach((group) => groups.appendChild(createDisplayBadge(group, "video-group")));
    card.append(remove, thumbnail, description, tags, groups);
    return card;
}

function createDisplayBadge(label, className) {
    const badge = document.createElement("span");
    badge.className = className;
    badge.textContent = label;
    return badge;
}

function safeThumbnailURL(candidate) {
    if (typeof candidate !== "string" || !candidate.trim()) return null;
    try {
        const url = new URL(candidate);
        return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch { return null; }
}

function isHttpLink(candidate) {
    try {
        const url = new URL(candidate);
        return url.protocol === "https:" || url.protocol === "http:";
    } catch { return false; }
}

function isDriveLink(candidate) {
    try {
        const host = new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
        return host === "drive.google.com" || host === "docs.google.com";
    } catch { return false; }
}

function getAutomaticThumbnailURL(link) {
    try {
        const url = new URL(link);
        const host = url.hostname.toLowerCase().replace(/^www\./, "");
        let id = null;
        if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0];
        if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
            const parts = url.pathname.split("/").filter(Boolean);
            id = url.pathname === "/watch" ? url.searchParams.get("v") : (["embed", "shorts", "live"].includes(parts[0]) ? parts[1] : null);
        }
        return id ? `https://img.youtube.com/vi/${encodeURIComponent(id)}/hqdefault.jpg` : null;
    } catch { return null; }
}

function createVideoPlayer(link) {
    let url;
    try { url = new URL(link); } catch { return null; }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let embedUrl = null;
    if (host === "youtu.be") {
        const id = url.pathname.split("/").filter(Boolean)[0];
        if (id) embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    } else if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
        const parts = url.pathname.split("/").filter(Boolean);
        const id = url.pathname === "/watch" ? url.searchParams.get("v") : (["embed", "shorts", "live"].includes(parts[0]) ? parts[1] : null);
        if (id) embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    } else if (host === "vimeo.com" || host === "player.vimeo.com") {
        const id = url.pathname.split("/").filter(Boolean).find((part) => /^\d+$/.test(part));
        if (id) embedUrl = `https://player.vimeo.com/video/${id}`;
    }
    if (embedUrl) {
        const iframe = document.createElement("iframe");
        if (host.includes("youtube") || host === "youtu.be") {
            const youtubeURL = new URL(embedUrl);
            youtubeURL.searchParams.set("enablejsapi", "1");
            youtubeURL.searchParams.set("origin", window.location.origin);
            embedUrl = youtubeURL.href;
        }
        iframe.src = embedUrl;
        iframe.title = "Video player";
        iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = "strict-origin-when-cross-origin";
        return iframe;
    }
    if (/\.(mp4|m4v|webm|ogv|ogg|mov)(?:$)/i.test(url.pathname)) {
        const player = document.createElement("video");
        const source = document.createElement("source");
        source.src = url.href;
        player.controls = true;
        player.appendChild(source);
        return player;
    }
    const iframe = document.createElement("iframe");
    iframe.src = url.href;
    iframe.title = "Video player";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    return iframe;
}

function createManagementControls() {
    const tagsSection = document.createElement("section");
    const tagHeading = document.createElement("h3");
    tagHeading.textContent = "Tags";
    const tagList = document.createElement("div");
    tagList.className = "video-tags";
    tagList.dataset.list = "tags";
    const tagControls = createInputControls("Add a tag", "tags", "Add tag", "tag-add");
    tagsSection.append(tagHeading, tagList, tagControls);

    const groupsSection = document.createElement("section");
    const groupHeading = document.createElement("h3");
    groupHeading.textContent = "Groups";
    const groupList = document.createElement("div");
    groupList.className = "video-groups";
    groupList.dataset.list = "groupIDs";
    const groupControls = createInputControls("Group ID", "groupIDs", "Add to group", "group-add");
    groupsSection.append(groupHeading, groupList, groupControls);
    return [tagsSection, groupsSection];
}

function createInputControls(placeholder, field, label, action) {
    const controls = document.createElement("div");
    controls.className = "card-controls";
    const input = document.createElement("input");
    input.id = `player-${field}-input`;
    input.name = `player-${field}`;
    input.placeholder = placeholder;
    input.dataset.input = field;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.action = action;
    controls.append(input, button);
    return controls;
}

function createManagementBadge(label, action, ariaLabel) {
    const badge = document.createElement("span");
    badge.className = action.startsWith("tag") ? "video-tag" : "video-group";
    badge.append(document.createTextNode(label));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.dataset.action = action;
    remove.dataset.value = label;
    remove.setAttribute("aria-label", ariaLabel);
    badge.appendChild(remove);
    return badge;
}

function fillManagementBadges(host, tags, groups) {
    const tagList = host.querySelector('[data-list="tags"]');
    const groupList = host.querySelector('[data-list="groupIDs"]');
    tagList.replaceChildren(...tags.map((tag) => createManagementBadge(tag, "tag-remove", `Remove tag ${tag}`)));
    groupList.replaceChildren(...groups.map((group) => createManagementBadge(group, "group-remove", `Remove from group ${group}`)));
}

function openVideoPlayer(video, playlist = activePlaylist, readOnly = false) {
    activePlaylistReadOnly = readOnly;
    activePlaylist = playlist?.length ? playlist : [video];
    activePlaylistIndex = activePlaylist.findIndex((item) => item.id === video.id);
    if (activePlaylistIndex < 0) { activePlaylist = [video]; activePlaylistIndex = 0; }
    showPlaylistItem();
    document.getElementById("videoPlayerDialog").showModal();
}

function showPlaylistItem() {
    const video = activePlaylist[activePlaylistIndex];
    if (!video) return;
    disposeCurrentProviderPlayer();
    const playerHost = document.getElementById("activeVideoPlayer");
    playerHost.replaceChildren();
    document.getElementById("playerDialogTitle").textContent = video.description || "Saved item";
    document.getElementById("playlistPosition").textContent = `${activePlaylistIndex + 1} / ${activePlaylist.length}`;
    document.getElementById("previousPlaylistItem").disabled = activePlaylistIndex === 0;
    document.getElementById("nextPlaylistItem").disabled = activePlaylistIndex === activePlaylist.length - 1;
    renderPlaylistGallery();

    if (video.itemType === "image") {
        const image = document.createElement("img");
        image.className = "playlist-image";
        image.src = video.link;
        image.alt = video.description || "Saved image";
        playerHost.appendChild(image);
    } else if (video.itemType === "file") {
        const panel = document.createElement("div");
        panel.className = "playlist-file";
        const note = document.createElement("p");
        note.textContent = video.description || "Saved file or archive.";
        const link = document.createElement("a");
        link.href = video.link;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Open file or archive";
        panel.append(note, link);
        playerHost.appendChild(panel);
    } else {
        const player = createVideoPlayer(video.link);
        if (!player) { status.textContent = "This video link cannot be played here."; return; }
        playerHost.appendChild(player);
        if (player instanceof HTMLVideoElement) player.addEventListener("ended", () => moveInPlaylist(1), { once: true });
        else if (player.src.includes("youtube.com/embed/")) connectYouTubeEndEvent(player);
        else if (player.src.includes("player.vimeo.com/video/")) connectVimeoEndEvent(player);
    }
    const controls = document.getElementById("playerVideoControls");
    controls.hidden = activePlaylistReadOnly;
    controls.replaceChildren();
    if (!activePlaylistReadOnly) {
        controls.dataset.videoId = video.id;
        controls.replaceChildren(...createManagementControls());
        fillManagementBadges(controls, video.tags, video.groupIDs);
    } else {
        delete controls.dataset.videoId;
    }
}

function renderPlaylistGallery() {
    const gallery = document.getElementById("playlistGallery");
    gallery.replaceChildren();
    activePlaylist.forEach((video, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "playlist-gallery-item";
        item.setAttribute("aria-current", index === activePlaylistIndex ? "true" : "false");
        item.setAttribute("aria-label", `${index + 1}: ${video.description || video.itemType}`);
        item.addEventListener("click", () => {
            activePlaylistIndex = index;
            showPlaylistItem();
        });
        if (video.thumbnail) {
            const image = document.createElement("img");
            image.src = video.thumbnail;
            image.alt = "";
            image.loading = "lazy";
            item.appendChild(image);
        } else {
            const placeholder = document.createElement("span");
            placeholder.className = "playlist-gallery-placeholder";
            placeholder.textContent = video.itemType === "file" ? "FILE" : video.itemType === "image" ? "IMAGE" : "VIDEO";
            item.appendChild(placeholder);
        }
        const caption = document.createElement("small");
        caption.textContent = video.description || `${video.itemType} ${index + 1}`;
        item.appendChild(caption);
        gallery.appendChild(item);
    });
    gallery.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function moveInPlaylist(offset) {
    const next = activePlaylistIndex + offset;
    if (next < 0 || next >= activePlaylist.length) return;
    activePlaylistIndex = next;
    showPlaylistItem();
}

function disposeCurrentProviderPlayer() {
    try {
        const result = currentProviderPlayer?.destroy
            ? currentProviderPlayer.destroy()
            : currentProviderPlayer?.unload?.();
        result?.catch?.(() => { });
    } catch { /* The iframe may already be gone. */ }
    currentProviderPlayer = null;
}

function connectYouTubeEndEvent(iframe) {
    ensureYouTubeApi().then(() => {
        if (!iframe.isConnected || !window.YT?.Player) return;
        currentProviderPlayer = new window.YT.Player(iframe, {
            events: { onStateChange: (event) => { if (event.data === window.YT.PlayerState.ENDED) moveInPlaylist(1); } }
        });
    }).catch(() => { });
}

function ensureYouTubeApi() {
    if (window.YT?.Player) return Promise.resolve();
    if (youtubeApiPromise) return youtubeApiPromise;
    youtubeApiPromise = new Promise((resolve, reject) => {
        const previousCallback = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { previousCallback?.(); resolve(); };
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.onerror = reject;
        document.head.appendChild(script);
    });
    return youtubeApiPromise;
}

function connectVimeoEndEvent(iframe) {
    ensureVimeoApi().then(() => {
        if (!iframe.isConnected || !window.Vimeo?.Player) return;
        currentProviderPlayer = new window.Vimeo.Player(iframe);
        currentProviderPlayer.on("ended", () => moveInPlaylist(1));
    }).catch(() => { });
}

function ensureVimeoApi() {
    if (window.Vimeo?.Player) return Promise.resolve();
    if (vimeoApiPromise) return vimeoApiPromise;
    vimeoApiPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://player.vimeo.com/api/player.js";
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
    return vimeoApiPromise;
}

function closeVideoPlayer() {
    const dialog = document.getElementById("videoPlayerDialog");
    disposeCurrentProviderPlayer();
    document.getElementById("activeVideoPlayer").replaceChildren();
    document.getElementById("playerVideoControls").replaceChildren();
    if (dialog.open) dialog.close();
}

function openRemovalChoices(video) {
    const choices = document.getElementById("videoRemovalChoices");
    choices.replaceChildren();
    const addChoice = (label, action, value = "") => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.dataset.action = action;
        button.dataset.videoId = video.id;
        if (value) button.dataset.value = value;
        choices.appendChild(button);
    };
    addChoice("Delete from database", "remove-from-database");
    video.tags.forEach((tag) => addChoice(`Remove from tag: ${tag}`, "remove-from-tag", tag));
    video.groupIDs.forEach((group) => addChoice(`Remove from group: ${group}`, "remove-from-group", group));
    document.getElementById("videoRemovalDialog").showModal();
}

document.getElementById("closeVideoPlayer").addEventListener("click", closeVideoPlayer);
document.getElementById("videoPlayerDialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeVideoPlayer();
});
document.getElementById("videoPlayerDialog").addEventListener("close", () => {
    document.getElementById("activeVideoPlayer").replaceChildren();
    document.getElementById("playerVideoControls").replaceChildren();
});
document.getElementById("cancelVideoRemoval").addEventListener("click", () => document.getElementById("videoRemovalDialog").close());

document.addEventListener("click", async (event) => {
    const play = event.target.closest("button[data-action='play-video']");
    if (play) {
        const id = play.closest(".video-card").dataset.videoId;
        const video = [...groupEntries.flatMap((group) => group.cards)].find((item) => item.id === id);
        if (video) openVideoPlayer(video);
        return;
    }
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "video-delete") {
        const id = button.closest(".video-card").dataset.videoId;
        const video = [...groupEntries.flatMap((group) => group.cards)].find((item) => item.id === id);
        if (video) openRemovalChoices(video);
        return;
    }
    if (["remove-from-database", "remove-from-tag", "remove-from-group"].includes(action)) {
        try {
            if (action === "remove-from-database") await deleteVideo(button.dataset.videoId);
            else await updateVideoField(button.dataset.videoId, action === "remove-from-tag" ? "tags" : "groupIDs", "remove", button.dataset.value);
            document.getElementById("videoRemovalDialog").close();
            if (document.getElementById("videoPlayerDialog").open) closeVideoPlayer();
            status.textContent = action === "remove-from-database" ? "Deleted saved video from the database." : "Removed video association.";
            await loadVideos();
        } catch (error) { showError(error); }
        return;
    }
    if (!["tag-add", "tag-remove", "group-add", "group-remove"].includes(action)) return;
    const host = button.closest("#playerVideoControls");
    if (!host) return;
    const field = action.startsWith("tag-") ? "tags" : "groupIDs";
    const item = button.dataset.value || host.querySelector(`[data-input="${field}"]`).value.trim();
    if (!item) { status.textContent = field === "tags" ? "Enter a tag first." : "Enter a group ID first."; return; }
    try {
        if (action === "tag-add") {
            await ensureTag(item);
            if (!indexedTags.some((tag) => tag.toLowerCase() === item.toLowerCase())) indexedTags.push(item);
            refreshTagSuggestions();
        }
        const operation = action.endsWith("remove") ? "remove" : "add";
        await updateVideoField(host.dataset.videoId, field, operation, item);
        const video = await getVideos().then((items) => items.find((item) => item.id === host.dataset.videoId));
        if (video) fillManagementBadges(host, video.tags || [], video.groupIDs || []);
        await loadVideos();
        status.textContent = `${operation === "add" ? "Added" : "Removed"} ${field === "tags" ? "tag" : "group"} ${item}.`;
    } catch (error) { showError(error); }
});

window.addEventListener("app:sessionchange", async (event) => {
    selectedGroupKey = null;
    if (event.detail.signedIn) {
        try {
            await loadTagSuggestions();
            await loadVideos();
            await routeFromHash();
        } catch (error) { showError(error); }
    } else {
        publicGroups = [];
        publicGroupsLoaded = false;
        currentPublicGroup = null;
        indexedTags = [];
        groupEntries = [];
        document.getElementById("videoDisplay").replaceChildren();
        document.getElementById("groupDisplay").replaceChildren();
        document.getElementById("groupDisplay").hidden = false;
        document.getElementById("videoView").hidden = true;
        document.getElementById("videoSearchSummary").textContent = "";
        document.getElementById("tagSearchResults").replaceChildren();
        document.getElementById("tagSearchResults").hidden = true;
        document.getElementById("groupSearchResults").replaceChildren();
        document.getElementById("groupSearchResults").hidden = true;
        closeVideoPlayer();
    }
});
