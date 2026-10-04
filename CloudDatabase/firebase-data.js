import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
    getFirestore, doc, getDoc, setDoc, collection, addDoc, getDocs,
    query, where, updateDoc, deleteDoc, serverTimestamp,
    arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBskmpxmPPhAZOv5ePxQ1E_27R5uy0nz5w",
    authDomain: "testdataset-ba1ed.firebaseapp.com",
    databaseURL: "https://testdataset-ba1ed-default-rtdb.firebaseio.com",
    projectId: "testdataset-ba1ed",
    storageBucket: "testdataset-ba1ed.firebasestorage.app",
    messagingSenderId: "580622553127",
    appId: "1:580622553127:web:6458992f649c92f3517e02"
};

const db = getFirestore(initializeApp(firebaseConfig));
export const session = { username: null, userId: null, userDocId: null };
const status = document.getElementById("status");
const value = (id) => document.getElementById(id).value.trim();

export function showError(error) {
    console.error(error);
    status.textContent = `Firebase error: ${error.message}`;
}

export async function findUser(username, password = "") {
    const matches = await getDocs(query(collection(db, "users"), where("username", "==", username)));
    let profile = matches.docs[0] || null;
    if (!profile) {
        const legacyProfile = await getDoc(doc(db, "users", username));
        if (legacyProfile.exists()) profile = legacyProfile;
    }
    if (!profile) return null;
    const data = profile.data();
    if (data.password && data.password !== password) {
        const error = new Error("Incorrect password.");
        error.code = "invalid-password";
        throw error;
    }
    if (!data.userID) throw new Error("This user profile does not have a userID.");
    return {
        username: data.username || username,
        userId: data.userID,
        userDocId: profile.id,
        description: data.description || "",
        profileImageURL: data.profileImageURL || ""
    };
}

export async function createUser({ username, password }) {
    const normalizedUsername = username.trim();
    if (!normalizedUsername || normalizedUsername.includes("/")) throw new Error("Choose a username without slashes.");
    if (!password) throw new Error("Choose a password.");
    const existing = await getDocs(query(collection(db, "users"), where("username", "==", normalizedUsername)));
    const legacyExisting = existing.empty ? await getDoc(doc(db, "users", normalizedUsername)) : null;
    if (!existing.empty || legacyExisting?.exists()) {
        const error = new Error("That username is already taken.");
        error.code = "username-taken";
        throw error;
    }
    const userID = crypto.randomUUID();
    const user = {
        username: normalizedUsername,
        userID,
        password,
        createdAt: serverTimestamp()
    };
    await setDoc(doc(db, "users", userID), user);
    return { username: user.username, userId: user.userID, userDocId: userID, description: "", profileImageURL: "" };
}

async function verifySession(user = session) {
    if (!user?.username || !user?.userId) throw new Error("Sign in before changing saved data.");
    const profile = await getDoc(doc(db, "users", user.userDocId));
    if (!profile.exists() || profile.data().userID !== user.userId) {
        throw new Error("The signed-in user profile could not be verified.");
    }
}

export async function saveUserProfile({ username, description, profileImageURL }) {
    await verifySession();
    const normalizedUsername = username.trim();
    if (!normalizedUsername || normalizedUsername.includes("/")) throw new Error("Choose a username without slashes.");
    const duplicates = await getDocs(query(collection(db, "users"), where("username", "==", normalizedUsername)));
    if (duplicates.docs.some((item) => item.data().userID !== session.userId)) {
        const error = new Error("That username is already taken.");
        error.code = "username-taken";
        throw error;
    }
    const legacy = await getDoc(doc(db, "users", normalizedUsername));
    if (legacy.exists() && legacy.data().userID !== session.userId) {
        const error = new Error("That username is already taken.");
        error.code = "username-taken";
        throw error;
    }
    const userRef = doc(db, "users", session.userDocId);
    const existing = await getDoc(userRef);
    await setDoc(userRef, {
        username: normalizedUsername,
        description,
        profileImageURL: profileImageURL || null,
        ...(!existing.exists() ? { createdAt: serverTimestamp() } : {})
    }, { merge: true });
    session.username = normalizedUsername;
}

export async function getPublicGroups() {
    const settingsSnapshot = await getDocs(query(collection(db, "groupSettings"), where("visibility", "==", "public")));
    const videoCache = new Map();
    const ownerCache = new Map();
    const publicGroups = [];

    for (const settingDoc of settingsSnapshot.docs) {
        const setting = settingDoc.data();
        const ownerId = setting.userID;
        const groupID = setting.groupID;
        if (!ownerId || !groupID) continue;

        if (!ownerCache.has(ownerId)) {
            const [profiles, ownerVideos] = await Promise.all([
                getDocs(query(collection(db, "users"), where("userID", "==", ownerId))),
                getDocs(query(collection(db, "videos"), where("userID", "==", ownerId)))
            ]);
            const profileDoc = profiles.docs[0];
            const profileData = profileDoc?.data() || {};
            ownerCache.set(ownerId, {
                username: profileData.username || profileDoc?.id || "Unknown user",
                profileImageURL: profileData.profileImageURL || "",
                description: profileData.description || ""
            });
            videoCache.set(ownerId, ownerVideos.docs.map((item) => ({ id: item.id, ...item.data() })));
        }

        const normalizedGroup = (setting.normalizedGroup || groupID).trim().toLowerCase();
        const items = (videoCache.get(ownerId) || []).filter((item) => {
            const groupIDs = Array.isArray(item.groupIDs) ? item.groupIDs : [];
            return normalizedGroup === "ungrouped"
                ? groupIDs.length === 0
                : groupIDs.some((value) => typeof value === "string" && value.trim().toLowerCase() === normalizedGroup);
        }).sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));

        publicGroups.push({
            key: `${ownerId}:${normalizedGroup}`,
            ownerId,
            owner: ownerCache.get(ownerId),
            groupID,
            items
        });
    }
    return publicGroups;
}

export async function getPublicProfile(username) {
    const matches = await getDocs(query(collection(db, "users"), where("username", "==", username)));
    let profile = matches.docs[0] || null;
    if (!profile) {
        const legacyProfile = await getDoc(doc(db, "users", username));
        if (legacyProfile.exists()) profile = legacyProfile;
    }
    if (!profile) return null;
    const data = profile.data();
    return {
        username: data.username || username,
        description: data.description || "",
        profileImageURL: data.profileImageURL || "",
        userId: data.userID || null
    };
}

export async function getTagIndex() {
    const snapshot = await getDocs(collection(db, "tagIndex"));
    return snapshot.docs.map((item) => item.data().tag).filter((tag) => typeof tag === "string");
}

export async function ensureTag(tag) {
    await verifySession();
    const normalizedTag = tag.trim().toLowerCase();
    const tagRef = doc(db, "tagIndex", encodeURIComponent(normalizedTag));
    const savedTag = await getDoc(tagRef);
    if (savedTag.exists()) return { tag: savedTag.data().tag || tag, exists: true };
    await setDoc(tagRef, { tag, normalizedTag, createdBy: session.userId, createdAt: serverTimestamp() });
    return { tag, exists: false };
}

export async function addVideo({ type = "video", link, description, thumbnailURL, tags, groupIDs = [] }) {
    await verifySession();
    const tagChecks = await Promise.all(tags.map(ensureTag));
    const ref = await addDoc(collection(db, "videos"), {
        userID: session.userId,
        type,
        link,
        description,
        thumbnailURL: thumbnailURL || null,
        tags,
        groupIDs,
        createdAt: serverTimestamp()
    });
    return { id: ref.id, tagChecks };
}

export async function getVideos() {
    await verifySession();
    const snapshot = await getDocs(query(collection(db, "videos"), where("userID", "==", session.userId)));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() ?? 0;
        const bTime = b.createdAt?.toMillis?.() ?? 0;
        return aTime - bTime;
    });
}

export async function getGroupVisibilities() {
    await verifySession();
    const snapshot = await getDocs(query(collection(db, "groupSettings"), where("userID", "==", session.userId)));
    return new Map(snapshot.docs.map((item) => {
        const data = item.data();
        return [(data.normalizedGroup || data.groupID || "").trim().toLowerCase(), data.visibility === "public" ? "public" : "private"];
    }));
}

export async function saveGroupVisibility(groupID, visibility) {
    await verifySession();
    if (!["public", "private"].includes(visibility)) throw new Error("Choose public or private group visibility.");
    const normalizedGroup = groupID.trim().toLowerCase();
    const docId = `${encodeURIComponent(session.userId)}_${encodeURIComponent(normalizedGroup)}`;
    await setDoc(doc(db, "groupSettings", docId), {
        userID: session.userId,
        groupID,
        normalizedGroup,
        visibility,
        updatedAt: serverTimestamp()
    }, { merge: true });
}

export async function updateVideoField(videoId, field, operation, value) {
    await verifySession();
    if (!["tags", "groupIDs"].includes(field)) throw new Error("Unsupported video field.");
    const videoRef = doc(db, "videos", videoId);
    const saved = await getDoc(videoRef);
    if (!saved.exists() || saved.data().userID !== session.userId) throw new Error("This video does not belong to the signed-in user.");
    await updateDoc(videoRef, { [field]: operation === "remove" ? arrayRemove(value) : arrayUnion(value) });
}

export async function deleteVideo(videoId) {
    await verifySession();
    const videoRef = doc(db, "videos", videoId);
    const saved = await getDoc(videoRef);
    if (!saved.exists() || saved.data().userID !== session.userId) throw new Error("This video does not belong to the signed-in user.");
    await deleteDoc(videoRef);
}

document.getElementById("saveUser").addEventListener("click", async () => {
    try {
        const imageInput = document.getElementById("profileImageURL");
        if (imageInput.value.trim() && !imageInput.checkValidity()) {
            status.textContent = "Enter a valid profile image URL.";
            return;
        }
        await saveUserProfile({
            username: value("username"),
            description: value("description"),
            profileImageURL: value("profileImageURL")
        });
        document.getElementById("userIdentity").textContent = `Signed in as ${session.username}.`;
        status.textContent = `Saved ${session.username}'s profile.`;
    } catch (error) {
        if (error.code === "username-taken") status.textContent = error.message;
        else showError(error);
    }
});
