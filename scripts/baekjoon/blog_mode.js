function b_startLoader() {
  loader = setInterval(async () => {
    // 기능 Off시 작동하지 않도록 함
    const enable = await checkEnable();
    if (!enable) stopLoader();
    else if (isExistResultTable()) {
      const table = findFromResultTable();
      if (isEmpty(table)) return;
      const data = table[0];
      if (data.hasOwnProperty('username') && data.hasOwnProperty('resultCategory')) {
        const { username, resultCategory } = data;
        if (username === findUsername() && resultCategory.includes(RESULT_CATEGORY.RESULT_ACCEPTED)) {
          stopLoader();
          console.log('풀이가 맞았습니다. 업로드를 시작합니다.');
          startUpload();
          const bojData = await b_findData();
          await b_beginUpload(bojData);
        }
      }
    }
  }, 2000);
}

async function b_findData(data) {
  try {
    if (isNull(data)) {
      let table = filter(findFromResultTable(), 'resultCategory', RESULT_CATEGORY.RESULT_ACCEPTED);
      table = filter(table, 'username', findUsername());
      if (isEmpty(table)) return null;
      data = selectBestSubmissionList(table)[0];
    }
    if (isNaN(Number(data.problemId)) || Number(data.problemId) < 1000) throw new Error(`정책상 대회 문제는 업로드 되지 않습니다. 대회 문제가 아니라고 판단된다면 이슈로 남겨주시길 바랍니다.\n문제 ID: ${data.problemId}`);
    data = { ...data, ...await findProblemInfoAndSubmissionCode(data.problemId, data.submissionId) };
    const detail = b_makeDetailMessageAndReadme(data);
    if(debug) console.log(`detail : ${detail}`)
    return { ...data, ...detail }; // detail 만 반환해도 되나, 확장성을 위해 모든 데이터를 반환합니다.
  } catch (error) {
    console.error(error);
  }
  return null;
}

/**
 * 파싱한 문제번호와 제출번호 목록을 가지고 업로드 가능한 배열로 가공하여 반환합니다.
 * @param {Array<Object>} datas
 * @returns {Array<Object>} 
 */
 async function b_findDatas(datas) {
  datas = datas.filter((data) => !isNaN(Number(data.problemId)) && Number(data.problemId) > 1000); // 대회 문제 제외
  details = await findProblemsInfoAndSubmissionCode(datas.map(x => x.problemId), datas.map(x => x.submissionId));
  datas = combine(datas, details);
  return datas.map((data) => {
    const detail = b_makeDetailMessageAndReadme(data);
    return { ...data, ...detail };
  });
}

/* 파싱 직후 실행되는 함수 */
async function b_beginUpload(bojData) {
  if (debug) console.log('bojData', bojData);
  if (isNotEmpty(bojData)) {
    const stats = await getStats();
    const hook = await getHook();

    const currentVersion = stats.version;
    /* 버전 차이가 발생하거나, 해당 hook에 대한 데이터가 없는 경우 localstorage의 Stats 값을 업데이트하고, version을 최신으로 변경한다 */
    if (isNull(currentVersion) || currentVersion !== getVersion() || isNull(await getStatsSHAfromPath(`${hook}/${bojData.directory}`))) {
      await b_versionUpdate();
    }

    /* 현재 제출하려는 소스코드가 기존 업로드한 내용과 같다면 중지 */
    if (debug) console.log('local:', await getStatsSHAfromPath(`${hook}/${bojData.directory}/${bojData.fileName}`), 'calcSHA:', calculateBlobSHA(bojData.code));
    if ((await getStatsSHAfromPath(`${hook}/${bojData.directory}/${bojData.fileName}`)) === calculateBlobSHA(bojData.code)) {
        markUploadedCSS();
        console.log(`현재 제출번호를 업로드한 기록이 있습니다.` /* submissionID ${bojData.submissionId}` */);
        return;
      }
    /* 신규 제출 번호라면 새롭게 커밋  */
    await b_uploadOneSolveProblemOnGit(bojData, markUploadedCSS);
  }
}

// submissionTime 블로그 포스팅 일자로 사용
function b_makeDetailMessageAndReadme(data) {
  const { problemId, submissionTime, title, level, tags,
    problem_description, problem_input, problem_output,
    code, language, memory, runtime } = data;

  const directory = `_posts/백준/${level.replace(/ .*/, '')}/${problemId}. ${convertSingleCharToDoubleChar(title)}`;
  const message = `[${level}] Title: ${title}, Time: ${runtime} ms, Memory: ${memory} KB -BaekjoonHub`;
  const tagl = [];
  tags.forEach((tag) => tagl.push(`${categories[tag.key]}(${tag.key})`));
  const category = tagl.join(', ');

  const fileName = `${convertSingleCharToDoubleChar(title)}.${languages[language]}`;
  const postName = `${getyymmdd('-')}-백준${problemId}.md`;
  // prettier-ignore-start
  // 포스트 내용
  const content = `---\n`
    + `title: '[백준] ${problemId}번: ${title}(${language}/${languages[language]})' \n`
    + `date: ${parseDate(submissionTime)}\n`
    + `categories: [알고리즘, 백준] \n`
    + `tags: [${category || ""}] \n`
    + `---\n\n`
    + `# [${level}] ${title} - ${problemId} \n\n`
    + `[문제 링크](https://www.acmicpc.net/problem/${problemId}) \n\n`
    + `### 성능 요약\n\n`
    + `메모리: ${memory} KB, `
    + `시간: ${runtime} ms\n\n`
    + `### 분류\n\n`
    + `${category || "Empty"}\n\n` + (!!problem_description ? ''
      + `### 문제 설명\n\n${problem_description}\n\n`
      + `### 입력 \n\n ${problem_input}\n\n`
      + `### 출력 \n\n ${problem_output}\n\n` : `\n\n`)
    + `### 정답 코드 \n\n`
    + '```'+`${languages[language]}\n`
    + `${code}\n`
    + '```';
  // prettier-ignore-end
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
  if(debug)console.log(`bojData : ${bojData}`)
  return b_upload(token, hook, bojData.code ,bojData.content, bojData.directory, bojData.fileName, bojData.message,bojData.postName, cb);
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
async function b_upload(token, hook,sourceText , content, directory, filename, commitMessage,postName, cb) {
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
  if(debug) console.log(post);

  const treeSHA = await git.createTree(refSHA, [source,post]);
  const commitSHA = await git.createCommit(commitMessage, treeSHA, refSHA);
  await git.updateHead(ref, commitSHA);

  /* stats의 값을 갱신합니다. */
  updateObjectDatafromPath(stats.submission, `${hook}/${post.path}`, post.sha);
  updateObjectDatafromPath(stats.submission, `${hook}/${source.path}`, source.sha);
  await saveStats(stats);
  // 콜백 함수 실행
  if (typeof cb === 'function') cb();
}


async function b_versionUpdate() {
  if (debug) console.log('start b_versionUpdate');
  const stats = await b_updateLocalStorageStats();
  // update version.
  stats.version = getVersion();
  await saveStats(stats);
  if (debug) console.log('b_stats updated.', stats);
}

async function b_updateLocalStorageStats() {
  const hook = await getHook();
  const token = await getToken();
  const git = new GitHub(hook, token);
  const stats = await getStats();
  const tree_items = [];
  await git.getTree().then((tree) => {
    tree.forEach((item) => {
      //블로그모드시 전체blob이 아닌 _posts/백준 하위폴더만 저장
      if ( (/^_posts\/백준/).test(item.path) && item.type === 'blob') {
        tree_items.push(item);
      }
    });
  });
  const { submission } = stats;
  tree_items.forEach((item) => {
    updateObjectDatafromPath(submission, `${hook}/${item.path}`, item.sha);
  });
  const default_branch = await git.getDefaultBranchOnRepo();
  stats.branches[hook] = default_branch;
  await saveStats(stats);
  if (debug) console.log('update stats', stats);
  return stats;
}


function b_insertUploadAllButton() {
  const profileNav = document.getElementsByClassName('nav-tabs')[0];
  if (debug) console.log('profileNav', profileNav);
  const uploadButton = document.createElement('li');
  uploadButton.innerHTML = '<a class="BJH_button" style="display:inline-table;"  title="지금까지 백준에 제출한 문제와 코드를 깃허브에 업로드할 수 있습니다.">전체제출 업로드</a>';
  profileNav.append(uploadButton);
  uploadButton.onclick = () => {
    if (confirm('현재까지 해결한 모든 문제가 업로드됩니다.\n실행 전에 사용 설명서를 참고하시는 것을 추천드립니다.\n\n진행하시겠습니까?')) {
      uploadButton.append(insertMultiLoader());
      b_uploadAllSolvedProblem();
    }
  };
}

/* 모든 코드를 github에 업로드하는 함수 */
async function b_uploadAllSolvedProblem() {
  const tree_items = [];

  // 업로드된 모든 파일에 대한 SHA 업데이트
  const stats = await b_updateLocalStorageStats();

  const hook = await getHook();
  const token = await getToken();
  const git = new GitHub(hook, token);

  const default_branch = stats.branches[hook];
  const { refSHA, ref } = await git.getReference(default_branch);

  const username = findUsername();
  if (isEmpty(username)) {
    if (debug) console.log('로그인되어 있지 않아. 파싱을 진행할 수 없습니다.');
    return;
  }
  const list = await findUniqueResultTableListByUsername(username);
  const { submission } = stats;
  const bojDatas = [];
  const datas = await b_findDatas(list);
  await Promise.all(
    datas.map(async (bojData) => {
      const sha = getObjectDatafromPath(submission, `${hook}/${bojData.directory}/${bojData.fileName}`);
      if (debug) console.log('sha', sha, 'calcSHA:', calculateBlobSHA(bojData.code));
      if (isNull(sha) || sha !== calculateBlobSHA(bojData.code)) {
        bojDatas.push(bojData);
      }
    }),
  );

  if (bojDatas.length === 0) {
    MultiloaderUpToDate();
    if (debug) console.log('업로드 할 새로운 코드가 하나도 없습니다.');
    return null;
  }
  setMultiLoaderDenom(bojDatas.length);
  await asyncPool(2, bojDatas, async (bojData) => {
    if (!isEmpty(bojData.code) && !isEmpty(bojData.content)) {
      const source = await git.createBlob(bojData.sourceText, `${bojData.directory}/${bojData.filename}`); // 소스코드 파일
      const post = await git.createBlob(bojData.content, `${bojData.directory}/${bojData.postName}`); // 포스트할 md파일
      tree_items.push(...[source, post]);
      if(debug) console.log(`source: ${source}`)
    }
    incMultiLoader(1);
  });

  try {
    if (tree_items.length !== 0) {
      const treeSHA = await git.createTree(refSHA, tree_items);
      const commitSHA = await git.createCommit('전체 코드 업로드 -BaekjoonHub', treeSHA, refSHA);
      await git.updateHead(ref, commitSHA);
      if (debug) console.log('전체 코드 업로드 완료');
      incMultiLoader(1);

      tree_items.forEach((item) => {
        updateObjectDatafromPath(submission, `${hook}/${item.path}`, item.sha);
      });
      await saveStats(stats);
    }
  } catch (error) {
    if (debug) console.log('전체 코드 업로드 실패', error);
  }
}







//날짜 형식 호출
function getyymmdd(separator) {
  const nD= new Date();
  const year = nD.getFullYear();
  const month = nD.getMonth() + 1;
  const date = nD.getDate();
return `${year}${separator}${month >= 10 ? month : '0' + month}${separator}${date >= 10 ? date : '0' + date}`;
}
function parseDate(submissonTime) {
  "2021년 5월 19일 16:26:22"
  return submissonTime.replace("년 ","-").replace("월 ","-").replace("일 ","-");
}
function getyyMMddhhmmss(separator) {
  const nD= new Date();
  const year = nD.getFullYear();
  const month = nD.getMonth() + 1;
  const date = nD.getDate();
  const hour = nD.getHours();
  const minute = nD.getMinutes();
  const second = nD.getSeconds();
return `${year}${separator}${month >= 10 ? month : '0' + month}${separator}${date >= 10 ? date : '0' + date}${separator}${hour >= 10 ? hour : '0' + hour}:${minute >= 10 ? minute : '0' + minute}:${second >= 10 ? second : '0' + second}`;
}