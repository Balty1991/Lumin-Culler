import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { db } from '../core/db';
import { contextEngine } from '../core/learning/ContextEngine';
import { summarizeAccuracy, MIN_DECISIONS_FOR_ACCURACY, type AccuracySummary } from '../core/learning/accuracy';
import type { FaceCluster } from '../core/faceClustering';
import { usePeopleFaces } from './faces';
import { readTasteScore, readDailyScore } from '../core/tasteScore';
import { translateSceneTag } from '../core/sceneTagLabels';
import { openTasteQuiz } from '../state/tasteQuiz';
import { FaceCropThumb } from '../ui/FaceCropThumb';
import { useTr } from './context';
import { Orb } from './Orb';

/**
 * lumin/BrainScreen.tsx
 * „AI-ul tău”: ce știe AI-ul despre tine. Cât de des alege ca tine (măsurat,
 * nu promis), ce a învățat în cuvinte, câte a văzut, și oamenii tăi — cu fața
 * lor, ca să știi pe cine numești (raportat: „Cine e această persoană?” fără
 * miniatura feței nu spunea la cine se referă).
 */
export function BrainScreen() {
  const tr = useTr();
  const photos = useStore(s => s.photos);
  const persons = useStore(s => s.persons);
  const locale = useStore(s => s.locale);
  const askPrompt = useStore(s => s.askPrompt);
  const askConfirm = useStore(s => s.askConfirm);
  const enrollFaceCluster = useStore(s => s.enrollFaceCluster);
  const rescorePhotos = useStore(s => s.rescorePhotos);

  const [accuracy, setAccuracy] = useState<AccuracySummary | null>(null);
  const [lessons, setLessons] = useState(0);
  const [notes, setNotes] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [level, setLevel] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const { people, unknown } = usePeopleFaces(persons, refresh);
  const training = readTasteScore();
  const daily = readDailyScore();

  useEffect(() => {
    let alive = true;
    void db.corrections.toArray().then(rows => {
      if (!alive) return;
      setLessons(rows.length);
      setAccuracy(summarizeAccuracy(rows));
    }).catch(() => {});
    void contextEngine.summarize(locale === 'en' ? 'en' : 'ro').then(models => {
      if (alive) setNotes([...new Set(models.flatMap(m => m.notes))].slice(0, 5));
    }).catch(() => {});
    void contextEngine.keptSubjects().then(list => {
      if (alive) setSubjects(list.map(x => translateSceneTag(x.tag, locale === 'en' ? 'en' : 'ro')));
    }).catch(() => {});
    void contextEngine.learnedWeight().then(w => { if (alive) setLevel(w); }).catch(() => {});
    return () => { alive = false; };
  }, [locale, refresh]);

  const memory = useMemo(() => {
    const groups = new Set(photos.filter(p => p.groupId).map(p => p.groupId));
    return {
      seen: photos.length,
      series: groups.size,
      decided: photos.filter(p => p.status === 'selected' || p.status === 'rejected').length
    };
  }, [photos]);

  const percent = accuracy && accuracy.total >= MIN_DECISIONS_FOR_ACCURACY
    ? Math.round(accuracy.agreement * 100)
    : training.total > 0 ? Math.round((training.hits / training.total) * 100) : null;
  const levelKey = level >= 1 ? 'lx.brain.level.trained' : level >= 0.3 ? 'lx.brain.level.learning' : 'lx.brain.level.new';

  const name = async (cluster: FaceCluster) => {
    const value = (await askPrompt(tr('lx.brain.namePrompt'), '', { confirmLabel: tr('lx.save') }))?.trim();
    if (!value) return;
    await enrollFaceCluster(value, cluster.members.map(m => ({ photoId: m.photoId, faceIndex: m.faceIndex, embedding: m.embedding })));
    setRefresh(n => n + 1);
  };
  const forget = async () => {
    if (!await askConfirm(tr('lx.brain.forgetConfirm'), { confirmLabel: tr('lx.brain.forget'), danger: true })) return;
    await contextEngine.reset();
    await rescorePhotos();
    setRefresh(n => n + 1);
  };

  return (
    <div className="lx-screen lx-brain">
      <header className="lx-head">
        <h1 className="lx-title">{tr('lx.brain.title')}</h1>
        <span className="lx-pill violet">{tr(levelKey)}</span>
      </header>

      <section className="lx-brain-hero">
        <Orb mood="learn" size={150} />
        <div className="lx-brain-score">
          <b className={percent === null ? 'none' : undefined}>{percent !== null ? `${percent}%` : '—'}</b>
          <span>
            {accuracy && accuracy.total >= MIN_DECISIONS_FOR_ACCURACY
              ? tr('lx.brain.agree', { count: accuracy.total })
              : training.total > 0
                ? tr('lx.brain.agreeTraining', { hits: training.hits, total: training.total, generic: training.genericHits })
                : tr('lx.brain.agreeNone', { left: Math.max(0, MIN_DECISIONS_FOR_ACCURACY - lessons) })}
          </span>
        </div>
      </section>

      <section className="lx-stats four">
        <div><b>{memory.seen}</b><span>{tr('lx.brain.seen')}</span></div>
        <div><b>{lessons}</b><span>{tr('lx.brain.lessons')}</span></div>
        <div><b>{memory.series}</b><span>{tr('lx.stat.series')}</span></div>
        <div><b>{persons.length}</b><span>{tr('lx.brain.people')}</span></div>
      </section>

      <section className="lx-section">
        <div className="lx-section-head"><h2>{tr('lx.brain.learned')}</h2></div>
        {daily.total > 0 && (
          <div className="tq-compare">
            <div><b className="v3-mono">{daily.hits}/{daily.total}</b><span>{tr('lx.brain.dailyYours')}</span></div>
            <div><b className="v3-mono">{daily.genericHits}/{daily.total}</b><span>{tr('taste.done.generic')}</span></div>
          </div>
        )}
        {subjects.length > 0 && (
          <div className="lx-subjects">
            <span>{tr('lx.brain.subjects')}</span>
            <div className="lx-chips">{subjects.map(x => <span key={x} className="lx-chip good">{x}</span>)}</div>
          </div>
        )}
        {notes.length > 0 ? (
          <ul className="lx-notes">{notes.map(n => <li key={n}>{n}</li>)}</ul>
        ) : (
          <p className="lx-empty small">{tr('lx.brain.learnedNone')}</p>
        )}
        <button className="lx-btn primary wide" onClick={openTasteQuiz}>{tr(training.total > 0 ? 'lx.brain.trainMore' : 'lx.brain.train')}</button>
      </section>

      <section className="lx-section">
        <div className="lx-section-head"><h2>{tr('lx.brain.yourPeople')}</h2></div>
        {people.length === 0 && unknown.length === 0 && <p className="lx-empty small">{tr('lx.brain.peopleNone')}</p>}
        <div className="lx-faces">
          {people.map(p => (
            <div key={p.name} className="lx-face">
              <FaceCropThumb photoId={p.photoId} box={p.box} size={72} className="lx-face-img" />
              <b>{p.name}</b>
              <span>{tr('lx.brain.photos', { count: p.photoIds.length })}</span>
            </div>
          ))}
          {unknown.map((c, i) => (
            <button key={`${c.members[0].photoId}-${i}`} className="lx-face unknown" onClick={() => void name(c)}>
              <FaceCropThumb photoId={c.members[0].photoId} box={c.members[0].box} size={72} className="lx-face-img" />
              <b>{tr('lx.brain.whoIs')}</b>
              <span>{tr('lx.brain.photos', { count: c.members.length })}</span>
            </button>
          ))}
        </div>
        {unknown.length > 0 && <p className="lx-hint">{tr('lx.brain.peopleHint')}</p>}
      </section>

      <section className="lx-card lx-privacy">
        <b>{tr('lx.brain.privacyTitle')}</b>
        <span>{tr('lx.brain.privacy')}</span>
      </section>

      <button className="lx-btn danger-ghost wide" onClick={() => void forget()}>{tr('lx.brain.forget')}</button>
    </div>
  );
}
