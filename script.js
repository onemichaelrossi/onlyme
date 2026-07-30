// Footer year
document.getElementById('year').textContent = new Date().getFullYear();

// Edit this value to update the LinkedIn link site-wide
const LINKEDIN_URL = "https://www.linkedin.com/in/michael-rossi-mbcs-citp-432b20a3";

const linkedinEl = document.getElementById('linkedin-link');
if (linkedinEl) linkedinEl.href = LINKEDIN_URL;


// Contact form -> Formspree (AJAX, stays on page)
const contactForm = document.getElementById('contact-form');
if (contactForm) {
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('cf-status');
    const btn = contactForm.querySelector('.cf-btn');
    btn.disabled = true;
    try {
      const res = await fetch(contactForm.action, {
        method: 'POST',
        body: new FormData(contactForm),
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        contactForm.reset();
        status.textContent = 'Thanks \u2014 your message has been sent.';
      } else {
        status.textContent = 'Sorry, something went wrong. Please email me directly.';
      }
    } catch (err) {
      status.textContent = 'Sorry, something went wrong. Please email me directly.';
    }
    status.hidden = false;
    btn.disabled = false;
  });
}
