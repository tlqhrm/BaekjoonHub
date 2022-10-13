function b_startLoader() {
  loader = setInterval(async () => {
    // 기능 Off시 작동하지 않도록 함
    const enable = await checkEnable();
    if (!enable) stopLoader();
    // 제출 후 채점하기 결과가 성공적으로 나왔다면 코드를 파싱하고, 업로드를 시작한다
    else if (getSolvedResult().includes('정답')) {
      if (debug) console.log('정답이 나왔습니다. 업로드를 시작합니다.');
      stopLoader();
      try {
        const bojData = await b_parseData();
        await b_beginUpload(bojData);
      } catch (error) {
        if (debug) console.log(error);
      }
    }
  }, 2000);
}

async function b_parseData() {
  const link = document.querySelector('head > meta[name$=url]').content.replace(/\?.*/g, '').trim();
  const problemId = document.querySelector('div.main > div.lesson-content').getAttribute('data-lesson-id');
  const level = levels[problemId] || 'unrated';
  const division = [...document.querySelector('ol.breadcrumb').childNodes]
    .filter((x) => x.className !== 'active')
    .map((x) => x.innerText)
    // .filter((x) => !x.includes('코딩테스트'))
    .map((x) => convertSingleCharToDoubleChar(x))
    .reduce((a, b) => `${a}/${b}`);
  const title = document.querySelector('#tab > li.algorithm-title').textContent.replace(/\\n/g, '').trim();
  const problem_description = document.querySelector('div.guide-section-description > div.markdown').innerHTML;
  const language_extension = document.querySelector('div.editor > ul > li.nav-item > a').innerText.split('.')[1]
  const code = document.querySelector('textarea#code').value;
  const result_message =
    [...document.querySelectorAll('#output > pre.console-content > div.console-message')]
      .map((x) => x.innerText)
      .filter((x) => x.includes(': '))
      .reduce((x, y) => `${x}<br/>${y}`, '') || 'Empty';
  const [runtime, memory] = [...document.querySelectorAll('td.result.passed')]
    .map((x) => x.innerText)
    .map((x) => x.replace(/[^., 0-9a-zA-Z]/g, '').trim())
    .map((x) => x.split(', '))
    .reduce((x, y) => (Number(x[0]) > Number(y[0]) ? x : y), ['0.00ms', '0.0MB'])
    .map((x) => x.replace(/(?<=[0-9])(?=[A-Za-z])/, ' '));

  return b_makeData({ link, problemId, level, title, problem_description, division, language_extension, code, result_message, runtime, memory });
}

async function b_makeData(origin) {
  const { problem_description, problemId, level, result_message, division, language_extension, title, runtime, memory, code } = origin;
  const directory = `_posts/${thisStie}/${level}/${problemId}. ${convertSingleCharToDoubleChar(title)}`;
  const message = `[${level.replace('lv', 'level ')}] Title: ${title}, Time: ${runtime}, Memory: ${memory} -BaekjoonHub`;
  const fileName = `${convertSingleCharToDoubleChar(title)}.${language_extension}`;
  const postName = `${getyymmdd('-')}-${thisStie}${problemId}.md`;
  // prettier-ignore
  const content = `---\n`
    + `title: '[${thisStie}] ${problemId}번: ${title}(${language_extension})' \n`
    + `date: ${getyyMMddhhmmss('-')}\n`
    + `categories: [${thisStie},${level}] \n`
    + `tags: [${division.split('/')}] \n`
    + `---\n\n`
    + `# [${level}] ${title} - ${problemId} \n\n`
    + `[문제 링크](https://www.acmicpc.net/problem/${problemId}) \n\n`
    + `### 성능 요약\n\n`
    + `메모리: ${memory}, `
    + `시간: ${runtime}\n\n`
    + `### 구분\n\n`
    + `${division.replace('/', ' > ')}\n\n`
    + `### 채점결과\n\n`
    + `${result_message}\n\n`
    + `### 문제 설명\n\n`
    + `${problem_description}\n\n`
    + `### 정답 코드 \n\n`
    + '```'+`${language_extension}\n`
    + `${code}\n`
    + '```\n'
    + `> 출처: 프로그래머스 코딩 테스트 연습, https://programmers.co.kr/learn/challenges`;
  return {
    directory,
    fileName,
    message,
    content,
    code,
    postName
  };
}

 async function b_uploadOneSolveProblemOnGit(bojData, cb) {
  const token = await getToken();
  const hook = await getHook();
  if (isNull(token) || isNull(hook)) {
    console.error('token or hook is null', token, hook);
    return;
  }
  return b_upload(token, hook, bojData.code, bojData.content, bojData.directory, bojData.fileName, bojData.message, bojData.postName, cb);
}

/** Github api를 사용하여 업로드를 합니다.
 * @see https://docs.github.com/en/rest/reference/repos#create-or-update-file-contents
 * @param {string} token - github api 토큰
 * @param {string} hook - github api hook
 * @param {string} sourceText - 업로드할 소스코드
 * @param {string} content - 업로드할 포스트 내용
 * @param {string} directory - 업로드할 파일의 경로
 * @param {string} filename - 업로드할 소스 파일명
 * @param {string} commitMessage - 커밋 메시지
 * @param {string} postName - 업로드할 포스트 제목
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
  const treeSHA = await git.createTree(refSHA, [source, post]);
  const commitSHA = await git.createCommit(commitMessage, treeSHA, refSHA);
  await git.updateHead(ref, commitSHA);

  /* stats의 값을 갱신합니다. */
  updateObjectDatafromPath(stats.submission, `${hook}/${source.path}`, source.sha);
  updateObjectDatafromPath(stats.submission, `${hook}/${post.path}`, post.sha);
  await saveStats(stats);
  // 콜백 함수 실행
  if (typeof cb === 'function') cb();
}

/* 파싱 직후 실행되는 함수 */
async function b_beginUpload(bojData) {
  if (debug) console.log('bojData', bojData);
  if (isNotEmpty(bojData)) {
    startUpload();

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
