import { session, findUser, createUser } from "./firebase-data.js";

// A page refresh always starts signed out, so discard any previous in-app route.
if (location.hash) history.replaceState(null, "", `${location.pathname}${location.search}`);

const status = document.getElementById("status");
const value = (id) => document.getElementById(id).value.trim();

function setAuthFeedback(id, message) {
    document.getElementById(id).textContent = message;
}

function showAuthError(error, feedbackId) {
    console.error(error);
    setAuthFeedback(feedbackId, `Could not complete request: ${error.message}`);
}

function enterSignedInState(user) {
        session.username = user.username;
        session.userId = user.userId;
        session.userDocId = user.userDocId;
        setAuthFeedback("signInFeedback", "");
        setAuthFeedback("createAccountFeedback", "");
        document.getElementById("signInPassword").value = "";
        document.getElementById("username").value = user.username;
        document.getElementById("userIdentity").textContent = `Signed in as ${user.username}.`;
        document.getElementById("description").value = user.description;
        document.getElementById("profileImageURL").value = user.profileImageURL;
        updateProfileImagePreview(user.profileImageURL);
        document.getElementById("authPage").hidden = true;
        document.getElementById("signedInContent").hidden = false;
        document.getElementById("signOutButton").hidden = false;
        status.textContent = `Signed in as ${user.username}.`;
        window.dispatchEvent(new CustomEvent("app:sessionchange", { detail: { signedIn: true } }));
}

async function signIn() {
    const requestedUsername = value("signInUsername");
    if (!requestedUsername) {
        setAuthFeedback("signInFeedback", "Enter a username.");
        return;
    }
    try {
        const user = await findUser(requestedUsername, document.getElementById("signInPassword").value);
        if (!user) {
            setAuthFeedback("signInFeedback", `No saved user named ${requestedUsername}.`);
            return;
        }
        enterSignedInState(user);
    } catch (error) {
        if (error.code === "invalid-password") setAuthFeedback("signInFeedback", error.message);
        else showAuthError(error, "signInFeedback");
    }
}

document.getElementById("createAccountForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = document.getElementById("newPassword").value;
    if (password !== document.getElementById("confirmPassword").value) {
        setAuthFeedback("createAccountFeedback", "The passwords do not match.");
        return;
    }
    try {
        const user = await createUser({ username: value("newUsername"), password });
        enterSignedInState(user);
        document.getElementById("createAccountForm").reset();
        status.textContent = `Account created. Signed in as ${user.username}.`;
    } catch (error) {
        if (error.code === "username-taken") setAuthFeedback("createAccountFeedback", error.message);
        else showAuthError(error, "createAccountFeedback");
    }
});

document.getElementById("signInButton").addEventListener("click", signIn);
document.getElementById("signInUsername").addEventListener("keydown", (event) => {
    if (event.key === "Enter") signIn();
});
document.getElementById("signInPassword").addEventListener("keydown", (event) => {
    if (event.key === "Enter") signIn();
});
document.getElementById("profileImageURL").addEventListener("input", (event) => updateProfileImagePreview(event.target.value.trim()));

function updateProfileImagePreview(candidate) {
    const image = document.getElementById("profileImagePreview");
    if (!candidate) {
        image.removeAttribute("src");
        image.hidden = true;
        return;
    }
    try {
        const url = new URL(candidate);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Use an HTTP or HTTPS image link.");
        image.onerror = () => { image.hidden = true; };
        image.onload = () => { image.hidden = false; };
        image.src = url.href;
    } catch {
        image.removeAttribute("src");
        image.hidden = true;
    }
}

document.getElementById("signOutButton").addEventListener("click", () => {
    session.username = null;
    session.userId = null;
    session.userDocId = null;
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    document.getElementById("signedInContent").hidden = true;
    document.getElementById("signOutButton").hidden = true;
    document.getElementById("authPage").hidden = false;
    document.getElementById("signInUsername").value = "";
    document.getElementById("signInPassword").value = "";
    document.getElementById("username").value = "";
    document.getElementById("description").value = "";
    document.getElementById("profileImageURL").value = "";
    document.getElementById("profileImagePreview").removeAttribute("src");
    document.getElementById("profileImagePreview").hidden = true;
    document.getElementById("videoTags").value = "";
    document.getElementById("tagFilter").value = "";
    document.getElementById("groupFilter").value = "";
    status.textContent = "Signed out.";
    window.dispatchEvent(new CustomEvent("app:sessionchange", { detail: { signedIn: false } }));
});
