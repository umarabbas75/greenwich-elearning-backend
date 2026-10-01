"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
const FIXTURE_DIR = (0, path_1.join)(__dirname, '..', 'src', 'utils', 'fixtures');
function lzwEncode(input) {
    const dictionary = new Map();
    for (let i = 0; i < 256; i += 1)
        dictionary.set(String.fromCharCode(i), i);
    let nextCode = 256;
    let current = '';
    const out = [];
    for (const char of input) {
        const candidate = current + char;
        if (dictionary.has(candidate)) {
            current = candidate;
        }
        else {
            out.push(dictionary.get(current));
            dictionary.set(candidate, nextCode);
            nextCode += 1;
            current = char;
        }
    }
    if (current !== '')
        out.push(dictionary.get(current));
    return out;
}
function buildHiraSuspendPayload() {
    const lessons = {};
    for (const index of [0, 1, 4]) {
        lessons[String(index)] = { c: 1, p: 100, i: blockMap(25, 25) };
    }
    lessons['2'] = { p: 18, i: blockMap(22, 4) };
    lessons['3'] = { p: 7, i: blockMap(27, 2) };
    lessons['5'] = { p: 4, i: blockMap(28, 1) };
    return { cpv: 'z9SXlNnk', progress: { p: 21, lessons } };
}
function blockMap(total, visited) {
    const out = {};
    for (let i = 0; i < total; i += 1) {
        if (i < visited)
            out[`b${i}`] = 1;
    }
    return out;
}
function writeSuspendFixture() {
    const json = JSON.stringify(buildHiraSuspendPayload());
    const envelope = { v: 3, d: lzwEncode(json) };
    (0, fs_1.writeFileSync)((0, path_1.join)(FIXTURE_DIR, 'rise-suspend-data-hira.json'), `${JSON.stringify(envelope)}\n`, 'utf8');
    console.log(`rise-suspend-data-hira.json — ${envelope.d.length} codes, ${json.length} chars decoded`);
}
function writeManifestFixture() {
    const titles = [
        'Key Terms in Hazard Identification and Risk Assessment',
        'Distinguishing Hazards, Hazardous Events, Risks, and Consequences',
        'The Systematic HIRA Process: From Preparation to Review',
        'Major Categories of Workplace Hazards',
        'The Importance of HIRA in Preventing Harm',
        'Considering Routine and Non-Routine Activities',
        'Identifying Who May Be Harmed',
        'Evaluating and Managing Controls: Existing vs. Additional',
        'Risk Evaluation Techniques and the Use of Risk Matrices',
        'Applying the Hierarchy of Controls',
        'Recording, Communicating, and Reviewing HIRAs',
        'Recognizing and Addressing Common HIRA Weaknesses',
        'Interpreting Scenarios and Prioritizing Risks',
    ];
    const lessons = titles.map((title, i) => ({
        id: `lesson-${i}`,
        type: 'blocks',
        title,
        position: i,
        items: new Array(20).fill({ id: 'b', type: 'text' }),
    }));
    lessons.unshift({
        id: 'lesson-quiz',
        type: 'quiz',
        title: 'Quiz',
        position: 13,
        items: new Array(13).fill({ id: 'q', type: 'multipleChoice' }),
        settings: { passingScore: 80 },
    });
    lessons.splice(3, 0, {
        id: 'lesson-removed',
        type: 'blocks',
        title: 'Removed In Authoring',
        position: 2.5,
        deleted: true,
        items: [],
    });
    const manifest = {
        course: {
            title: 'Hazard Identification and Risk Assessment (HIRA)',
            navigationMode: '',
            exportSettings: { reporting: 'passed-incomplete' },
            lessons,
        },
        settings: { reporting: 'passed-incomplete' },
    };
    const base64 = Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64');
    (0, fs_1.writeFileSync)((0, path_1.join)(FIXTURE_DIR, 'rise-runtime-hira.js'), `__jsonp("runtime-data.js","${base64}")\n`, 'utf8');
    console.log('rise-runtime-hira.js — 14 live lessons (1 deleted, quiz repositioned)');
}
function writeRegistrationFixtures() {
    const suspendData = JSON.parse((0, fs_1.readFileSync)((0, path_1.join)(FIXTURE_DIR, 'rise-suspend-data-hira.json'), 'utf8'));
    const base = {
        id: 'f896568a-7a28-43c0-9a6e-9a2b12818406',
        instance: 0,
        registrationCompletion: 'INCOMPLETE',
        registrationCompletionAmount: 0.0,
        registrationSuccess: 'UNKNOWN',
        totalSecondsTracked: 1966.0,
        firstAccessDate: '2026-09-20T17:50:14Z',
        lastAccessDate: '2026-09-21T07:38:33Z',
        createdDate: '2026-09-20T17:49:49Z',
        learner: { id: 'learner-1', firstName: 'Given', lastName: 'Family' },
        course: { id: '79d7a9fc-c669-44df-990b-ac1d83c9bd53', title: 'HIRA' },
        xapiRegistrationId: '9b927a85-0000-0000-0000-000000000000',
    };
    const activity = {
        id: 'B0',
        title: 'Hazard Identification and Risk Assessment (HIRA)',
        activityCompletion: 'INCOMPLETE',
        activitySuccess: 'UNKNOWN',
        attempts: 1,
        completionAmount: { scaled: 0.0 },
        suspended: true,
        timeTracked: '0000:00:00',
    };
    const sco = {
        ...activity,
        id: 'i1',
        timeTracked: '0000:32:46.40',
        children: [],
    };
    const runtime = {
        completionStatus: 'incomplete',
        runtimeSuccessStatus: 'UNKNOWN',
        location: 'index.html#/lessons/lesson-5',
        entry: 'resume',
        exit: 'suspend',
        progressMeasure: '',
        scoreScaled: '',
        scoreRaw: '',
        totalTime: '0000:32:30.18',
        timeTracked: '0000:32:46.40',
        mode: 'normal',
        credit: 'credit',
        suspendData: JSON.stringify(suspendData),
    };
    const write = (name, body) => (0, fs_1.writeFileSync)((0, path_1.join)(FIXTURE_DIR, name), `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    write('scorm-registration-course.json', {
        ...base,
        activityDetails: { ...activity, children: [] },
    });
    write('scorm-registration-activity.json', {
        ...base,
        activityDetails: { ...activity, children: [sco] },
    });
    write('scorm-registration-full.json', {
        ...base,
        activityDetails: { ...activity, children: [{ ...sco, runtime }] },
    });
    console.log('scorm-registration-{course,activity,full}.json');
}
writeSuspendFixture();
writeManifestFixture();
writeRegistrationFixtures();
console.log('\nFixtures written to src/utils/fixtures');
//# sourceMappingURL=build-scorm-fixtures.js.map