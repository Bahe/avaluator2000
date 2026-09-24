/*
 * Avaluator2000 — servidor de Google Apps Script
 * Copyright (c) 2026 Bahe · https://github.com/Bahe/avaluator2000
 *
 * Licensed under the EUPL, Version 1.2 or – as soon as they will be approved by
 * the European Commission – subsequent versions of the EUPL (the "Licence").
 * You may not use this work except in compliance with the Licence.
 * You may obtain a copy of the Licence at: https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed
 * under the Licence is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR
 * CONDITIONS OF ANY KIND, either express or implied.
 */

/**
 * Avaluator2000 · Avaluació per resultats d'aprenentatge
 * Servidor Google Apps Script: serveix l'aplicació i desa les dades a Google Drive.
 *
 * COM DESPLEGAR-HO (5 minuts):
 *  1. Ves a https://script.new (crea un projecte d'Apps Script nou).
 *  2. Enganxa aquest codi al fitxer "Code.gs" (substitueix el contingut d'exemple).
 *  3. Menú "+" al costat de Fitxers → HTML → anomena'l exactament: index
 *     Enganxa-hi TOT el contingut del fitxer avaluator2000.html.
 *  4. Desa (Ctrl+S) i prem "Implementa" → "Nova implementació" → tipus "Aplicació web":
 *       - Executa com a: Jo
 *       - Qui té accés: Només jo   (o "Qualsevol usuari del domini" si vols compartir-ho)
 *  5. Autoritza els permisos quan t'ho demani i obre l'URL que et dona (acaba en /exec).
 *     Desa't aquest URL als marcadors: és la teva aplicació, accessible des de qualsevol lloc.
 *
 * Les dades es desen al fitxer "avaluator2000.json" del teu Drive (el crea sol el primer cop;
 * el pots moure a la carpeta que vulguis, el seguirà trobant pel nom).
 * Si ja venies de la versió anterior, que el desava com a "avaluacio_mp8.json", l'aplicació
 * el reanomena sola el primer cop: no es perd cap dada.
 *
 * NOTA: si més endavant actualitzes el codi o l'HTML, cal "Implementa" →
 * "Gestiona les implementacions" → llapis → versió "Nova" → "Implementa" perquè
 * l'URL /exec serveixi la versió nova.
 *
 * IMPORTACIÓ DES DE GOOGLE CLASSROOM (opcional — només cal si vols fer servir els botons
 * "Importa de Google Classroom…" i "Des de Classroom"):
 *  1. Al projecte d'Apps Script, obre "Serveis" (icona "+" al menú lateral "Serveis").
 *  2. Afegeix el servei avançat "Google Classroom API" i desa.
 *  3. IMPORTANT — declara els permisos explícitament (si no, l'error típic és
 *     "classroom.courses.students.list ... The caller does not have permission"):
 *       a) Configuració del projecte (icona d'engranatge) → marca
 *          "Mostra el fitxer de manifest appsscript.json a l'editor".
 *       b) Obre appsscript.json i enganxa-hi el bloc "oauthScopes" del fitxer
 *          appsscript.json que acompanya aquest projecte (o copia'n el fitxer sencer).
 *     Apps Script dedueix els permisos mirant el codi i, amb serveis avançats, es queda curt:
 *     demana només el de cursos, però llistar alumnat necessita classroom.rosters.readonly
 *     i llistar tasques necessita classroom.coursework.students.readonly.
 *  4. Torna a "Implementa" → "Gestiona les implementacions" → llapis → versió "Nova" →
 *     "Implementa" perquè els nous permisos s'apliquin.
 *  5. Obre l'URL /exec: Google tornarà a demanar autorització (ara amb els permisos nous).
 *     Si no la demana i l'error persisteix, revoca l'accés antic a
 *     https://myaccount.google.com/permissions i torna a entrar.
 *
 *  Notes: tots els permisos són de només lectura sobre Classroom (aquesta app no hi modifica
 *  res). Has de ser professor/a del curs que importes: si hi ets com a alumne o només
 *  convidat, Classroom continuarà retornant "The caller does not have permission".
 */

var NOM_FITXER = 'avaluator2000.json';
var NOM_FITXER_ANTIC = 'avaluacio_mp8.json'; // nom que feia servir l'aplicació abans

/** Serveix l'aplicació. */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle("Avaluator2000")
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Retorna (o crea) el fitxer de dades a Drive.
 * Si encara no existeix amb el nom nou però sí amb l'antic, el reanomena: així el canvi
 * de nom no fa perdre les dades de qui ja feia servir l'aplicació.
 */
function fitxer_() {
  var iterador = DriveApp.getFilesByName(NOM_FITXER);
  if (iterador.hasNext()) return iterador.next();
  var antic = DriveApp.getFilesByName(NOM_FITXER_ANTIC);
  if (antic.hasNext()) {
    var f = antic.next();
    f.setName(NOM_FITXER);
    return f;
  }
  return DriveApp.createFile(NOM_FITXER, '', 'application/json');
}

/** Llegeix el JSON de dades (o null si encara no n'hi ha). */
function llegeixDades() {
  var contingut = fitxer_().getBlob().getDataAsString('UTF-8');
  return contingut && contingut.trim() ? contingut : null;
}

/** Desa el JSON de dades (amb bloqueig per evitar escriptures simultànies). */
function desaDades(json) {
  // validació mínima abans d'escriure
  if (typeof json !== 'string' || json.length < 2) throw new Error('Dades buides');
  JSON.parse(json); // llança error si no és JSON vàlid
  var pany = LockService.getScriptLock();
  pany.waitLock(10000);
  try {
    fitxer_().setContent(json);
  } finally {
    pany.releaseLock();
  }
  return true;
}

/* =========================================================================
 * Importació des de Google Classroom (només lectura).
 * Requereix el servei avançat "Google Classroom API" activat (vegeu capçalera).
 * ========================================================================= */

/** Llista els cursos actius de Classroom on el docent hi té accés. */
function llistaCursosClassroom() {
  var cursos = [];
  var pageToken;
  do {
    var resp = Classroom.Courses.list({ courseStates: ['ACTIVE'], pageToken: pageToken, pageSize: 100 });
    (resp.courses || []).forEach(function (c) { cursos.push({ id: c.id, nom: c.name, seccio: c.section || '' }); });
    pageToken = resp.nextPageToken;
  } while (pageToken);
  return cursos;
}

/** Retorna el llistat d'alumnes d'un curs de Classroom: [{classroomId, nom}]. */
function importaAlumnesClassroom(courseId) {
  var alumnes = [];
  var pageToken;
  try {
    do {
      var resp = Classroom.Courses.Students.list(courseId, { pageToken: pageToken, pageSize: 100 });
      (resp.students || []).forEach(function (s) {
        alumnes.push({ classroomId: s.userId, nom: (s.profile && s.profile.name && s.profile.name.fullName) || 'Alumne/a' });
      });
      pageToken = resp.nextPageToken;
    } while (pageToken);
  } catch (e) {
    throw new Error(explicaErrorClassroom_(e, "llistar l'alumnat", "classroom.rosters.readonly"));
  }
  return alumnes;
}

/**
 * Converteix els errors críptics de l'API de Classroom en un missatge accionable.
 * El cas típic ("The caller does not have permission") gairebé sempre és un permís que
 * falta al manifest appsscript.json, no pas un problema de rol dins del curs.
 */
function explicaErrorClassroom_(e, accio, scope) {
  var txt = String(e && e.message ? e.message : e);
  if (txt.indexOf('does not have permission') !== -1 || txt.indexOf('PERMISSION_DENIED') !== -1
      || txt.indexOf('insufficient') !== -1 || txt.indexOf('Insufficient') !== -1) {
    return "No s'ha pogut " + accio + ": falta el permís «" + scope + "».\n\n"
      + "Com arreglar-ho:\n"
      + "1) A l'editor d'Apps Script: Configuració del projecte → marca «Mostra el fitxer de manifest appsscript.json».\n"
      + "2) Afegeix «" + scope + "» a la llista oauthScopes del manifest (vegeu la capçalera de Code.gs).\n"
      + "3) Implementa → Gestiona les implementacions → llapis → versió «Nova» → Implementa.\n"
      + "4) Torna a obrir l'URL /exec i accepta els permisos nous.\n\n"
      + "Si tot i això falla, comprova que ets professor/a d'aquest curs de Classroom.\n\n"
      + "(Error original: " + txt + ")";
  }
  return txt;
}

/** Retorna les tasques (courseWork) d'un curs de Classroom, amb la seva categoria de qualificació. */
function importaActivitatsClassroom(courseId) {
  var treballs = [];
  var pageToken;
  var notesCurs = llegeixNotesClassroom_(courseId);
  try {
    do {
      var resp = Classroom.Courses.CourseWork.list(courseId, { pageToken: pageToken, pageSize: 100, courseWorkStates: ['PUBLISHED', 'DRAFT'] });
      (resp.courseWork || []).forEach(function (t) {
        treballs.push({
          classroomId: t.id,
          nom: t.title || 'Tasca sense títol',
          categoriaClassroomId: t.gradeCategory ? t.gradeCategory.id : null,
          categoriaNom: t.gradeCategory ? t.gradeCategory.name : null,
          maxPoints: t.maxPoints || 0,
          esborrany: t.state === 'DRAFT',
          temaId: t.topicId || null,
          rubrica: llegeixRubrica_(courseId, t.id),
          notes: notesCurs[t.id] || {}
        });
      });
      pageToken = resp.nextPageToken;
    } while (pageToken);
  } catch (e) {
    throw new Error(explicaErrorClassroom_(e, "llistar les tasques", "classroom.coursework.students.readonly"));
  }
  return treballs;
}

/**
 * DIAGNÒSTIC — executa'm des de l'editor d'Apps Script (tria "diagnosticEsborranys"
 * al desplegable de funcions i prem "Executa"), després mira "Registre d'execució".
 * Et dirà, per a cada curs, quantes tasques publicades i quantes en esborrany veu.
 * Si aquí surten esborranys però l'aplicació web no te'n mostra, el que passa és que
 * l'URL /exec encara serveix una versió antiga: Implementa → Gestiona les implementacions
 * → llapis → versió "Nova" → Implementa.
 */
function diagnosticEsborranys() {
  var cursos = llistaCursosClassroom();
  if (!cursos.length) { Logger.log('No es veu cap curs actiu amb aquest compte.'); return; }
  cursos.forEach(function (c) {
    try {
      var tots = importaActivitatsClassroom(c.id);
      var esb = tots.filter(function (t) { return t.esborrany; }).length;
      Logger.log('%s — %s tasques en total: %s publicades, %s en esborrany',
        c.nom, tots.length, tots.length - esb, esb);
    } catch (e) {
      Logger.log('%s — ERROR: %s', c.nom, e.message);
    }
  });
  Logger.log('Si els números quadren amb el que veus a Classroom, el servidor està bé i només cal redesplegar.');
}

/**
 * Rúbrica d'una tasca (o null si no en té, o si l'API de rúbriques no està disponible).
 * Les rúbriques de Classroom tenen criteris i, dins de cada criteri, nivells amb punts opcionals.
 */
function llegeixRubrica_(courseId, courseWorkId) {
  try {
    var resp = Classroom.Courses.CourseWork.Rubrics.list(courseId, courseWorkId);
    var r = (resp.rubrics || [])[0];
    if (!r || !r.criteria || !r.criteria.length) return null;
    return {
      criteris: r.criteria.map(function (cr) {
        return {
          titol: cr.title || '',
          descripcio: cr.description || '',
          nivells: (cr.levels || []).map(function (lv) {
            return { titol: lv.title || '', descripcio: lv.description || '', punts: (lv.points === undefined || lv.points === null) ? null : lv.points };
          })
        };
      })
    };
  } catch (e) {
    return null; // rúbriques no disponibles en aquest projecte/llicència: no bloquegem la importació
  }
}

/**
 * Notes ja posades a Classroom, de tot el curs en una sola crida (courseWorkId "-").
 * Retorna { courseWorkId: { userId: { punts, esborrany } } }.
 * Es prioritza assignedGrade (nota publicada) i, si no n'hi ha, draftGrade (pendent de publicar),
 * que és visible per al professorat encara que l'alumnat no la vegi.
 */
function llegeixNotesClassroom_(courseId) {
  var notes = {};
  var pageToken;
  try {
    do {
      var resp = Classroom.Courses.CourseWork.StudentSubmissions.list(courseId, '-', { pageToken: pageToken, pageSize: 100 });
      (resp.studentSubmissions || []).forEach(function (s) {
        var publicada = (s.assignedGrade !== undefined && s.assignedGrade !== null);
        var punts = publicada ? s.assignedGrade
          : ((s.draftGrade !== undefined && s.draftGrade !== null) ? s.draftGrade : null);
        if (punts === null) return;
        if (!notes[s.courseWorkId]) notes[s.courseWorkId] = {};
        notes[s.courseWorkId][s.userId] = { punts: punts, esborrany: !publicada };
      });
      pageToken = resp.nextPageToken;
    } while (pageToken);
  } catch (e) {
    return {}; // sense accés a les entregues: s'importa l'estructura sense notes
  }
  return notes;
}

/** Temes (topics) del curs, en l'ordre que retorna Classroom. */
function llistaTemesClassroom_(courseId) {
  var temes = [];
  var pageToken;
  try {
    do {
      var resp = Classroom.Courses.Topics.list(courseId, { pageToken: pageToken, pageSize: 100 });
      (resp.topic || []).forEach(function (t) { temes.push({ id: t.topicId, nom: t.name || 'Tema' }); });
      pageToken = resp.nextPageToken;
    } while (pageToken);
  } catch (e) {
    return []; // sense permís de temes: s'importarà tot en un sol RA
  }
  return temes;
}

/**
 * Importa un curs sencer de Classroom: dades bàsiques, categories de qualificació
 * (amb el seu pes), alumnat i tasques (amb la categoria assignada a cadascuna).
 * El pes de Classroom ve en milionèsimes (100% = 1.000.000), per això es divideix per 10.000.
 */
function importaCursClassroom(courseId) {
  var curs = Classroom.Courses.get(courseId);
  var gs = curs.gradebookSettings || {};
  var categories = (gs.gradeCategories || []).map(function (c) {
    return { classroomId: c.id, nom: c.name || 'Categoria', pes: c.weight ? Math.round(c.weight / 10000) : 0 };
  });
  var temes = llistaTemesClassroom_(courseId);
  var noms = {};
  temes.forEach(function (t) { noms[t.id] = t.nom; });
  var activitats = importaActivitatsClassroom(courseId);
  activitats.forEach(function (a) { a.temaNom = a.temaId ? (noms[a.temaId] || null) : null; });

  return {
    courseId: curs.id,
    nom: curs.name || 'Mòdul',
    seccio: curs.section || '',
    calculationType: gs.calculationType || '',
    categories: categories,
    temes: temes,
    alumnes: importaAlumnesClassroom(courseId),
    activitats: activitats
  };
}
