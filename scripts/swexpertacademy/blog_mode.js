function b_parseAndUpload() {
  //async wrapper
  (async () => {
    const bojData = await b_parseData();
    await b_beginUpload(bojData);
  })();
}
function b_startLoader() {
  loader = setInterval(async () => {
    // 기능 Off시 작동하지 않도록 함
    const enable = await checkEnable();
    if (!enable) stopLoader();
    // 제출 후 채점하기 결과가 성공적으로 나왔다면 코드를 파싱하고,
    // 결과 페이지로 안내한다.
    else if (getSolvedResult().includes('pass입니다')) {
      if (debug) console.log('정답이 나왔습니다. 코드를 파싱합니다');
      stopLoader();
      try {
        const { contestProbId } = await parseCode();
        // prettier-ignore
        await makeSubmitButton(`${window.location.origin}`
          + `/main/code/problem/problemSolver.do?`
          + `contestProbId=${contestProbId}&`
          + `nickName=${getNickname()}&`
          + `extension=BaekjoonHub`);
      } catch (error) {
        if (debug) console.log(error);
      }
    }
  }, 2000);
}

async function b_parseData() {
  const nickname = document.querySelector('#searchinput').value;

  if (debug) console.log('사용자 로그인 정보 및 유무 체크', nickname, document.querySelector('#problemForm div.info'));
  // 검색하는 유저 정보와 로그인한 유저의 닉네임이 같은지 체크
  // PASS를 맞은 기록 유무 체크
  if (getNickname() !== nickname) return;
  if (isNull(document.querySelector('#problemForm div.info'))) return;

  if (debug) console.log('결과 데이터 파싱 시작');

  const title = document
    .querySelector('div.problem_box > p.problem_title')
    .innerText.replace(/ D[0-9]$/, '')
    .replace(/^[^.]*/, '')
    .substr(1)
    .trim();
  // 레벨
  const level = document.querySelector('div.problem_box > p.problem_title > span.badge')?.textContent || 'Unrated';
  // 문제번호
  const problemId = document.querySelector('body > div.container > div.container.sub > div > div.problem_box > p').innerText.split('.')[0].trim();
  // 문제 콘테스트 인덱스
  const contestProbId = [...document.querySelectorAll('#contestProbId')].slice(-1)[0].value;
  // 문제 링크
  const link = `${window.location.origin}/main/code/problem/problemDetail.do?contestProbId=${contestProbId}`;

  // 문제 언어, 메모리, 시간소요
  const language = document.querySelector('#problemForm div.info > ul > li:nth-child(1) > span:nth-child(1)').textContent.trim();
  const memory = document.querySelector('#problemForm div.info > ul > li:nth-child(2) > span:nth-child(1)').textContent.trim().toUpperCase();
  const runtime = document.querySelector('#problemForm div.info > ul > li:nth-child(3) > span:nth-child(1)').textContent.trim();
  const length = document.querySelector('#problemForm div.info > ul > li:nth-child(4) > span:nth-child(1)').textContent.trim();

  // 확장자명
  const extension = languages[language.toLowerCase()];

  // 로컬스토리지에서 기존 코드에 대한 정보를 불러올 수 없다면 코드 디테일 창으로 이동 후 제출하도록 이동
  const data = await getProblemData(problemId);
  if (debug) console.log('data', data);
  if (isNull(data?.code)) {
    // 기존 문제 데이터를 로컬스토리지에 저장하고 코드 보기 페이지로 이동
    // await updateProblemData(problemId, { level, contestProbId, link, language, memory, runtime, length, extension });
    // const contestHistoryId = document.querySelector('div.box-list > div > div > span > a').href.replace(/^.*'(.*)'.*$/, '$1');
    // window.location.href = `${window.location.origin}/main/solvingProblem/solvingProblem.do?contestProbId=${contestProbId}`;
    console.error('소스코드 데이터가 없습니다.');
    return;
  }
  const code = data.code;
  if (debug) console.log('파싱 완료');
  // eslint-disable-next-line consistent-return
  return b_makeData({ link, problemId, level, title, extension, code, runtime, memory, length });
}

async function b_makeData(origin) {
  const { link, problemId, level, extension, title, runtime, memory, code, length } = origin;
  const directory = `_posts/${thisStie}/${level}/${problemId}. ${convertSingleCharToDoubleChar(title)}`;
  const message = `[${level}] Title: ${title}, Time: ${runtime}, Memory: ${memory} -BaekjoonHub`;
  const fileName = `${convertSingleCharToDoubleChar(title)}.${extension}`;
  const postName = `${getyymmdd('-')}-${thisStie}${problemId}.md`;
  // prettier-ignore
  const content = `---\n`
    + `title: '[${thisStie}] ${problemId}번: ${title}(${extension})' \n`
    + `date: ${getyyMMddhhmmss('-')}\n`
    + `categories: [${thisStie},${level}] \n`
    // + `tags: [${division.split('/')}] \n`
    + `---\n\n`
    +`# [${level}] ${title} - ${problemId} \n\n`
    + `[문제 링크](${link}) \n\n`
    + `### 성능 요약\n\n`
    + `메모리: ${memory}, `
    + `시간: ${runtime}, `
    + `코드길이: ${length} Bytes\n\n`
    + `\n\n`
    + `### 정답 코드 \n\n`
    + '```'+`${extension}\n`
    + `${code}\n`
    + '```\n'
    + `> 출처: SW Expert Academy, https://swexpertacademy.com/main/code/problem/problemList.do`;
    return {
      directory,
      fileName,
      message,
      content,
      code,
      postName
    };
}

/* 파싱 직후 실행되는 함수 */
async function b_beginUpload(bojData) {
  if (debug) console.log('bojData', bojData);
  startUpload();
  if (isNotEmpty(bojData)) {
    const stats = await getStats();
    const hook = await getHook();

    const currentVersion = stats.version;
    /* 버전 차이가 발생하거나, 해당 hook에 대한 데이터가 없는 경우 localstorage의 Stats 값을 업데이트하고, version을 최신으로 변경한다 */
    if (isNull(currentVersion) || currentVersion !== getVersion() || isNull(await getStatsSHAfromPath(hook))) {
      await b_versionUpdate();
    }

    /* 현재 제출하려는 소스코드가 기존 업로드한 내용과 같다면 중지 */
    if (debug) console.log('local:', await getStatsSHAfromPath(`${hook}/${bojData.directory}/${bojData.fileName}`), 'calcSHA:', calculateBlobSHA(bojData.code));
    if ((await getStatsSHAfromPath(`${hook}/${bojData.directory}/${bojData.fileName}`)) === calculateBlobSHA(bojData.code)) {
      markUploadedCSS();
      console.log(`현재 제출번호를 업로드한 기록이 있습니다. problemIdID ${bojData.problemId}`);
      return;
    }
    /* 신규 제출 번호라면 새롭게 커밋  */
    await b_uploadOneSolveProblemOnGit(bojData, markUploadedCSS);
  }
}

async function b_versionUpdate() {
  if (debug) console.log('start versionUpdate');
  const stats = await b_updateLocalStorageStats();
  // update version.
  stats.version = getVersion();
  await saveStats(stats);
  if (debug) console.log('stats updated.', stats);
}

async function b_uploadOneSolveProblemOnGit(bojData, cb) {
  const token = await getToken();
  const hook = await getHook();
  if (isNull(token) || isNull(hook)) {
    console.error('token or hook is null', token, hook);
    return;
  }
  return b_upload(token, hook, bojData.code ,bojData.content, bojData.directory, bojData.fileName, bojData.message,bojData.postName, cb);
}

/** Github api를 사용하여 업로드를 합니다.
 * @see https://docs.github.com/en/rest/reference/repos#create-or-update-file-contents
 * @param {string} token - github api 토큰
 * @param {string} hook - github api hook
 * @param {string} sourceText - 업로드할 소스코드
 * @param {string} readmeText - 업로드할 readme
 * @param {string} directory - 업로드할 파일의 경로
 * @param {string} filename - 업로드할 파일명
 * @param {string} commitMessage - 커밋 메시지
 * @param {function} cb - 콜백 함수 (ex. 업로드 후 로딩 아이콘 처리 등)
 */
async function b_upload(token, hook, sourceText, content, directory, filename, commitMessage,postName, cb) {
  /* 업로드 후 커밋 */
  const git = new GitHub(hook, token);
  const stats = await getStats();
  let default_branch = stats.branches[hook];
  if (isNull(default_branch)) {
    default_branch = await git.getDefaultBranchOnRepo();
    stats.branches[hook] = default_branch;
  }
  const { refSHA, ref } = await git.getReference(default_branch);
  const source = await git.createBlob(sourceText, `${directory}/${filename}`); // 소스코드 파일
  const post = await git.createBlob(content, `${directory}/${postName}`); // 포스트할 md파일
  const treeSHA = await git.createTree(refSHA, [source,post]);
  const commitSHA = await git.createCommit(commitMessage, treeSHA, refSHA);
  await git.updateHead(ref, commitSHA);

  /* stats의 값을 갱신합니다. */
  updateObjectDatafromPath(stats.submission, `${hook}/${source.path}`, source.sha);
  updateObjectDatafromPath(stats.submission, `${hook}/${post.path}`, post.sha);
  await saveStats(stats);
  // 콜백 함수 실행
  if (typeof cb === 'function') cb();
}