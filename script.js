// Footer year
document.getElementById('year').textContent = new Date().getFullYear();

// Contact links — edit these two values to update LinkedIn / social links site-wide
const LINKEDIN_URL = "https://www.linkedin.com/in/REPLACE_ME";
const SOCIAL_URL = "https://x.com/REPLACE_ME";

const linkedinEl = document.getElementById('linkedin-link');
if (linkedinEl) linkedinEl.href = LINKEDIN_URL;

const socialEl = document.getElementById('social-link');
if (socialEl) socialEl.href = SOCIAL_URL;
