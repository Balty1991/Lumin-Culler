import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { db } from '../core/db';
import { contextEngine } from '../core/learning/ContextEngine';
import { PeopleGrid } from './People';
import { readTasteScore, readDailyScore } from '../core/tasteScore';
import { translateSceneTag } from '../core/sceneTagLabels';
import { favoritePeople } from '../core/personTaste';
import { openTasteQuiz } from '../state/tasteQuiz';
import { useTr } from './context';
import { AutonomyPicker, FreedCard, TwinHero } from './TwinParts';
import { Housekeeping } from './Housekeeping';

/**
 * lumin/BrainScreen.tsx
 * „Copia ta”: AI-ul care alege ca tine — cât de bine te imită, cât îi dai
 * voie să facă singur, ce spațiu a eliberat. Dedesubt, ce știe AI-ul despre tine. Cât de des alege ca tine (măsurat,
 * nu promis), ce a învățat în cuvinte, câte a văzut, și oamenii tăi — cu fața
 * lor, ca să știi pe cine numești (raportat: „Cine e această persoană?” fără
 * miniatura feței nu spunea la cine se referă).
 */
export function BrainScreen() {
  const tr = useTr();
  const photos = useStore(s => s.photos);
  const persons = useStore(s => s.persons);
  const locale = useStore(s => s.locale);
  const askConfirm = useStore(s => s.askConfirm);
  const rescorePhotos = useStore(s => s.rescorePhotos);

  const [lessons, setLessons] = useState(0);
  const [notes, setNotes] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [level, setLevel] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const training = readTasteScore();
  const daily = readDailyScore();
  const loved = favoritePeople();

  useEffect(() => {
    let alive = true;
    void db.corrections.toArray().then(rows => {
      if (!alive) return;
      setLessons(rows.length);
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

  const levelKey = level >= 1 ? 'lx.brain.level.trained' : level >= 0.3 ? 'lx.brain.level.learning' : 'lx.brain.level.new';

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

      <TwinHero />

      <section className="lx-group">
        <h2>{tr('lx.twin.autonomy')}</h2>
        <AutonomyPicker />
      </section>

      <FreedCard />
      <Housekeeping />

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
        {loved.length > 0 && (
          <div className="lx-subjects">
            <span>{tr('lx.brain.loved')}</span>
            <div className="lx-chips">{loved.map(f => <span key={f.name} className="lx-chip good">{f.name} · {Math.round(f.rate * 100)}%</span>)}</div>
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
        <PeopleGrid />
      </section>

      <section className="lx-card lx-privacy">
        <b>{tr('lx.brain.privacyTitle')}</b>
        <span>{tr('lx.brain.privacy')}</span>
      </section>

      <button className="lx-btn danger-ghost wide" onClick={() => void forget()}>{tr('lx.brain.forget')}</button>
    </div>
  );
}
