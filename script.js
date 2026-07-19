// Footer year
document.getElementById('year').textContent = new Date().getFullYear();

// Edit this value to update the LinkedIn link site-wide
const LINKEDIN_URL = "https://www.linkedin.com/in/REPLACE_ME";

const linkedinEl = document.getElementById('linkedin-link');
if (linkedinEl) linkedinEl.href = LINKEDIN_URL;
