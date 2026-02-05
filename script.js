const CORS_PROXY = "https://cors.eu.org/";
// if cors.eu.org is down:
// https://cors.io/?u=
// https://corsproxy.io/?url=

const POST_LIMIT = 100; // reddit api max per request
const SUBREDDIT = "ExplainAFilmPlotBadly";

let posts = [], validatedRiddles = [], lastSort = "", isLoadingPost = false;

const shuffle = arr => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const cleanAnswer = text => text.trim().replace(/[?!.]+$/, '');

// fetch movie poster
async function getMoviePoster(movieName) {
  try {
    const searchQuery = encodeURIComponent(`${movieName} MOVIE POSTER`);
    const spUrl = `https://www.startpage.com/sp/search?query=${searchQuery}&cat=images&language=english&lui=english`;
    const resp = await fetch(CORS_PROXY + encodeURIComponent(spUrl));
    if (!resp.ok) return null;
    const html = await resp.text();
    return extractStartpageImage(html) || null;
  } catch (err) {
    console.log("Error fetching poster:", err);
    return null;
  }
}

// can you guess who wrote this? i did not
function extractStartpageImage(html) {
  const imgRegex = /<img[^>]*src="\/av\/proxy-image\?piurl=([^"]+)"[^>]*>/g;
  const matches = [...html.matchAll(imgRegex)];

  for (const match of matches) {
    try {
      const fullImgTag = match[0];
      let piurlParam = match[1];

      const heightMatch = fullImgTag.match(/height="(\d+)px"/);
      if (heightMatch) {
        const height = parseInt(heightMatch[1]);
        // skip small filter thumbnails (40px x 40px)
        if (height <= 50) continue;
      }

      // decode HTML entities
      piurlParam = piurlParam.replace(/&amp;/g, '&');
      const piurlValue = piurlParam.split('&')[0];
      const imageUrl = decodeURIComponent(piurlValue);

      // filter out other small images
      if (imageUrl.includes('thumbnail') ||
        imageUrl.includes('logo') ||
        imageUrl.includes('icon')) {
        continue;
      }

      return imageUrl;
    } catch (e) {
      continue;
    }
  }

  return null;
}


// fetch multiple pages to build larger pool
async function getPostList(sort) {
  const base = `https://www.reddit.com/r/${SUBREDDIT}/`;
  const endpoint = (sort === "new") ? "new.json" : "top.json";
  const timeParam = (sort === "all" || sort === "year" || sort === "month") ? `t=${sort}&` : '';

  let allPosts = [];
  let after = null;
  const pagesToFetch = 5; // fetch 5 pages = 500 posts

  for (let i = 0; i < pagesToFetch; i++) {
    // build URL properly based on whether we have timeParam and after
    let url = `${base}${endpoint}?${timeParam}limit=${POST_LIMIT}`;
    if (after) url += `&after=${after}`;

    const resp = await fetch(CORS_PROXY + encodeURIComponent(url));
    if (!resp.ok) break;

    const data = await resp.json();
    const children = data.data.children;
    if (!children.length) break;

    allPosts.push(...children
      .filter(post => {
        const p = post.data;
        return !p.stickied && !p.over_18 && (!p.selftext || p.selftext.trim() === '');
      })
      .map(post => ({
        permalink: post.data.permalink,
        title: post.data.title,
        author: post.data.author,
        score: post.data.score,
        validated: false
      })));

    after = data.data.after;
    if (!after) break;
  }

  return allPosts;
}


// validate post by checking comments
async function validatePost(post) {
  try {
    const commentsUrl = `https://www.reddit.com${post.permalink}.json`;
    const commentsResp = await fetch(CORS_PROXY + encodeURIComponent(commentsUrl));
    if (!commentsResp.ok) return null;

    const commentsData = await commentsResp.json();
    if (!commentsData[1]?.data?.children) return null;

    const comments = commentsData[1].data.children;
    let solvedAnswer = null;

    for (const comment of comments) {
      if (!comment.data?.body || comment.data.body === '[deleted]') continue;

      const replies = comment.data.replies;
      if (!replies?.data?.children) continue;

      for (const reply of replies.data.children) {
        if (reply.data?.author === post.author &&
          reply.data?.body?.toLowerCase().includes('solved')) {
          solvedAnswer = cleanAnswer(comment.data.body);
          break;
        }
      }
      if (solvedAnswer) break;
    }

    if (!solvedAnswer) return null;
    post.validated = true;

    return {
      title: post.title,
      answer: solvedAnswer,
      score: post.score,
      posterLoaded: false,
      posterUrl: null
    };
  } catch (err) {
    console.log("Error validating post:", err);
    return null;
  }
}

async function getNextValidRiddle() {
  if (validatedRiddles.length > 0) return validatedRiddles.shift();

  while (posts.length > 0) {
    const post = posts.shift();
    if (post.validated) continue;
    const riddle = await validatePost(post);
    if (riddle) return riddle;
  }

  throw new Error("No more valid riddles found in pool");
}

function showLoadingSpinner() {
  document.getElementById("story").innerHTML = `
    <div class="loading-spinner">
      <div class="spinner"></div>
      <span class="loading-text">finding next movie...</span>
    </div>
  `;
}

function renderRiddle(riddle) {
  const storyEl = document.getElementById("story");
  storyEl.classList.remove('revealed'); // Remove highlight from previous riddle

  storyEl.innerHTML =
    `<span class="first-sentence">${riddle.title}</span>
     <span id="hiddenSentence" class="censor-block" title="reveal">
       <span class="censor-highlight">${riddle.answer}</span>
     </span>
     <span class="upvotes">${riddle.score.toLocaleString()} upvotes</span>
     <div class="selectors">
       <select id="sort">
         <option value="all" ${lastSort === "all" ? "selected" : ""}>top all time</option>
         <option value="year" ${lastSort === "year" ? "selected" : ""}>top this year</option>
         <option value="month" ${lastSort === "month" ? "selected" : ""}>top this month</option>
         <option value="new" ${lastSort === "new" ? "selected" : ""}>new</option>
       </select>
       <button id="reload">next movie</button>
     </div>
     <img id="moviePoster" class="movie-poster" alt="${riddle.answer}">`;

  const el = document.getElementById("hiddenSentence");
  const mark = el.querySelector('.censor-highlight');
  const poster = document.getElementById("moviePoster");
  let isRevealed = false;

  document.getElementById("reload").onclick = showNextRiddle;
  document.getElementById("sort").onchange = loadInitialPosts;

  if (!riddle.posterLoaded) {
    getMoviePoster(riddle.answer).then(url => {
      riddle.posterUrl = url;
      riddle.posterLoaded = true;
      if (url && poster) poster.src = url;
    });
  } else if (riddle.posterUrl) {
    poster.src = riddle.posterUrl;
  }

  poster.onload = function () {
    if (isRevealed && this.src) {
      this.classList.add('loaded');
      setTimeout(() => this.classList.add('visible'), 10);
    }
  };

  poster.onerror = function () { this.style.display = 'none'; };

  el.addEventListener('click', function () {
    const storyEl = document.getElementById('story');
    if (isRevealed) {
      mark.style.background = '#101010';
      mark.style.color = '#101010';
      el.setAttribute("title", "reveal");
      poster.classList.remove('visible', 'loaded');
      storyEl.classList.remove('revealed');
    } else {
      mark.style.background = 'transparent';
      mark.style.color = '#181818';
      el.removeAttribute("title");
      storyEl.classList.add('revealed');

      if (riddle.posterUrl && poster.complete && poster.naturalHeight > 0) {
        poster.classList.add('loaded');
        setTimeout(() => poster.classList.add('visible'), 10);
      } else if (riddle.posterUrl) {
        poster.classList.add('loaded');
      }
    }
    isRevealed = !isRevealed;
  });
}

async function loadInitialPosts() {
  const sort = document.getElementById("sort")?.value || "all";
  document.getElementById("story").innerHTML = '<span class="loading">loading post pool...</span>';

  try {
    if (sort !== lastSort || !posts.length) {
      posts = shuffle(await getPostList(sort));
      validatedRiddles = [];
      lastSort = sort;
    }

    if (!posts.length) throw new Error("No posts found.");
    await showNextRiddle();
  } catch (e) {
    document.getElementById("story").innerHTML =
      `<span class="loading">failed to load: ${e.message}</span>`;
  }
}

async function showNextRiddle() {
  if (isLoadingPost) return;

  try {
    isLoadingPost = true;
    showLoadingSpinner();
    const riddle = await getNextValidRiddle();
    renderRiddle(riddle);
  } catch (e) {
    document.getElementById("story").innerHTML =
      `<span class="loading">failed to load riddle: ${e.message}</span>`;
  } finally {
    isLoadingPost = false;
  }
}

window.onload = loadInitialPosts;

// info popup functionality
const infoBtn = document.getElementById('infoBtn');
const infoPopup = document.getElementById('infoPopup');
const closePopup = document.getElementById('closePopup');

infoBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  infoPopup.classList.add('show');
});

closePopup.addEventListener('click', () => {
  infoPopup.classList.remove('show');
});

infoPopup.addEventListener('click', (e) => {
  if (e.target === infoPopup) {
    infoPopup.classList.remove('show');
  }
});

// close popup with Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && infoPopup.classList.contains('show')) {
    infoPopup.classList.remove('show');
  }
});


// typing "JARRETT" disables the background
let keySequence = '';
let backgroundEnabled = true;

document.addEventListener('keydown', (e) => {
  keySequence += e.key.toUpperCase();

  // keep only the last 7 characters
  if (keySequence.length > 7) {
    keySequence = keySequence.slice(-7);
  }

  if (keySequence === 'JARRETT') {
    backgroundEnabled = !backgroundEnabled;
    const bgElement = document.querySelector('body::before');

    if (backgroundEnabled) {
      document.body.style.setProperty('--bg-display', 'block');
      document.body.classList.remove('no-background');
    } else {
      document.body.classList.add('no-background');
    }

    // visual feedback
    document.body.style.transition = 'background-color 0.3s';
    document.body.style.backgroundColor = backgroundEnabled ? '#fff' : '#fafafa';

    keySequence = ''; // reset sequence
  }
});

