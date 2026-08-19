// Bahasa Melayu — Malay (Malaysia).
//
// Written to be read the way a Malaysian tech product actually talks to its
// users, not as a word-for-word rendering of the English. A few conventions
// hold throughout, and they are the reason the file reads the way it does.
//
//   · Malay does not mark plural with a suffix, so a phrase that branches on
//     `n` in English (`tag`/`tags`) collapses to a single invariant string
//     here — see lb.noTagMatch for the pattern.
//   · Established tech loanwords are kept as-is rather than forced into a
//     native equivalent, because that is how a Malaysian developer actually
//     writes and reads them day to day: Markdown, prompt, metadata, URL,
//     LaTeX, Mermaid. Everyday nouns get the Malay word instead (senarai,
//     not "list"; kata laluan, not "password").
//   · "Baharu" (the Dewan Bahasa spelling), not the colloquial "baru", is
//     used throughout for "new". Quoted titles use curly “ ” quotes, same as
//     the English source's typography.
//   · Buttons and confirmations read as short imperative/noun phrases, the
//     way Malay software chrome normally does ("Simpan", not "Simpan
//     sekarang" or a full sentence).
//
// Proper nouns (Bento OS), code identifiers, and example commands stay as
// they are — translating `curl` would be worse than useless.

export default {
  /* ── app shell ─────────────────────────────────────────────── */
  'app.title': 'Bento OS',

  'nav.tools': 'Alat',
  'nav.tab.logbook': 'Buku Log Dokumen',
  'nav.tab.logbook.short': 'Buku Log',
  'nav.tab.prompts': 'Pustaka Prompt',
  'nav.tab.prompts.short': 'Prompt',
  'nav.tab.snippets': 'Coretan Kod',
  'nav.tab.snippets.short': 'Coretan',
  'nav.minimize': 'Kecilkan alat semasa ke dok',
  'nav.focus': 'Togol mod fokus',
  'nav.fullscreen': 'Togol skrin penuh',
  'nav.unsaved': 'Perubahan belum disimpan',
  'nav.offline': 'luar talian',
  'nav.hostUnreachable': 'Hos tidak dapat dihubungi',
  'nav.accountMenu': 'Menu akaun',
  'nav.account': 'Akaun',
  'nav.dock': 'Alat yang dikecilkan',

  'menu.admin': 'Pengurusan pengguna',
  'menu.changepw': 'Tukar kata laluan',
  'menu.install': 'Pasang Bento OS…',
  'menu.delete': 'Padam akaun saya…',
  'menu.signout': 'Log keluar',

  'theme.toggle': 'Togol tema terang atau gelap',
  'lang.toggle': 'Tukar bahasa paparan',
  'lang.label': 'Bahasa',

  'main.focusOn': 'Mod fokus dihidupkan',
  'main.focusOff': 'Mod fokus dimatikan',
  'main.noFullscreen': 'Skrin penuh tidak disokong di sini',
  'main.updated': 'Bento OS telah dikemas kini — memuat semula',
  'main.restore': ({ name }) => `Pulihkan ${name}`,
  'main.minimized': ({ name }) => `${name} dikecilkan ke dok`,
  'main.restored': ({ name }) => `${name} dipulihkan`,

  'pwa.installed': 'Bento OS dipasang — kini ia dibuka dalam tetingkapnya sendiri',
  'pwa.updateReady': 'Kemas kini sedia — ia digunakan pada kali seterusnya anda membuka Bento OS',

  'ui.dismissNotice': 'Ketepikan notis',

  'clip.title': 'Salin secara manual',
  'clip.body':
    'Akses papan keratan tidak tersedia di sini (memerlukan HTTPS — contohnya URL tailscale serve). Pilih dan salin teks di bawah:',

  /* ── shared vocabulary ─────────────────────────────────────── */
  'common.cancel': 'Batal',
  'common.delete': 'Padam',
  'common.save': 'Simpan',
  'common.gotIt': 'Faham',
  'common.copy': 'Salin',
  'common.copied': '✓ Disalin',
  'common.close': 'Tutup',
  'common.back': 'Kembali',
  'common.done': 'Selesai',
  'common.all': 'Semua',
  'common.clearFilters': 'Kosongkan penapis',
  'common.commaSeparated': '(dipisahkan koma)',
  'common.markdownSupported': '· Markdown disokong',
  'common.reloadTheirs': 'Muat semula versi mereka',
  'common.overwriteTheirs': 'Tulis ganti versi mereka',
  'common.filterByTag': 'Tapis mengikut tag',
  'common.willBeDeleted': ({ title }) => `“${title}” akan dipadam secara kekal.`,
  'common.noMatchQuery': ({ q }) => `Tiada yang sepadan dengan “${q}”.`,
  'common.noMatchTags': 'Tiada yang sepadan dengan tag yang dipilih.',
  'common.placeholderHint': 'Klik ruang letak yang ditonjolkan untuk mengisinya.',
  'common.varsHintPre': 'Pemboleh ubah dalam kurungan dakap kembar seperti ',
  'common.varsHintPost': ' menjadi ruang letak yang boleh disunting terus pada kad.',
  'common.savedElsewhere': 'Disimpan pada peranti lain',

  'time.now': 'sekarang',
  'time.minutes': ({ n }) => `${n}m lalu`,
  'time.hours': ({ n }) => `${n}j lalu`,
  'time.days': ({ n }) => `${n}h lalu`,

  /* ── Docs LogBook ──────────────────────────────────────────── */
  'lb.new': 'Entri Baharu',
  'lb.import': 'Import',
  'lb.importTitle': 'Import sebagai fail Markdown',
  'lb.searchLabel': 'Cari entri',
  'lb.searchPlaceholder': 'Cari tajuk, tag, nota…',
  'lb.groupBy': 'Kumpulkan entri mengikut',
  'lb.group.flat': 'Rata',
  'lb.group.label': 'Label',
  'lb.group.year': 'Tahun',
  'lb.savedEntries': 'Entri tersimpan',
  'lb.guide': 'Panduan Markdown',
  'lb.guideClose': 'Tutup panduan',
  'lb.openList': 'Buka senarai entri',
  'lb.hideSidebar': 'Sembunyikan bar sisi',
  'lb.showSidebar': 'Tunjukkan bar sisi',
  'lb.titleLabel': 'Tajuk entri',
  'lb.titlePlaceholder': 'Entri tanpa tajuk',
  'lb.edited': 'Disunting',
  'lb.hideMeta': 'Sembunyikan metadata',
  'lb.showMeta': 'Tunjukkan metadata',
  'lb.readMode.title': 'Mod bacaan — klik untuk sunting',
  'lb.readMode.aria': 'Mod bacaan (tukar ke editor)',
  'lb.editMode.title': 'Mod editor — klik untuk baca',
  'lb.editMode.aria': 'Mod editor (tukar ke bacaan)',
  'lb.save': 'Simpan Entri',
  'lb.saving': 'Menyimpan…',
  'lb.savedFlash': '✓ Disimpan',
  'lb.close': 'Tutup entri',
  'lb.summary': 'Ringkasan / Pernyataan Masalah',
  'lb.summaryLabel': 'Ringkasan atau pernyataan masalah',
  'lb.summaryPlaceholder': 'Masalah apa yang diselesaikan oleh entri ini?',
  'lb.body': 'Kandungan',
  'lb.bodyHint': '(Kandungan: pengetahuan, penyelesaian, cara mengatasi masalah, jalan pintas)',
  'lb.formatting': 'Pemformatan',
  'lb.bulb': 'Rujukan sintaks: templat LaTeX dan Mermaid',
  'lb.bulbMenu': 'Sisipkan templat sintaks',
  'lb.viewToggle': 'Editor atau pratonton',
  'lb.write': 'Tulis',
  'lb.preview': 'Pratonton',
  'lb.editorLabel': 'Butiran Markdown dan penyelesaian',
  'lb.editorPlaceholder':
    'Tulis nota anda dalam Markdown…\n\n$matematik sebaris$, $$matematik blok$$, dan gambar rajah ```mermaid turut disokong.',
  'lb.resize': 'Ubah saiz editor dan pratonton',
  'lb.previewLabel': 'Pratonton terpapar',
  'lb.empty': 'Tiada entri dibuka — pilih satu daripada senarai, atau mulakan yang baharu.',
  'lb.previewFailed': 'Pratonton gagal dipaparkan.',
  'lb.delete': 'Padam entri',
  'lb.drawer': 'Entri',

  'lb.noMatch': ({ q }) => `Tiada entri sepadan dengan “${q}”.`,
  'lb.noEntries': 'Belum ada entri — cipta yang pertama.',
  'lb.clearSearch': 'Kosongkan carian',
  'lb.noTagMatch': () => 'Tiada entri sepadan dengan tag yang dipilih.',
  'lb.clearTagFilter': 'Kosongkan penapis tag',

  'lb.unsaved.title': 'Perubahan belum disimpan',
  'lb.unsaved.body': 'Entri ini mempunyai suntingan yang belum disimpan.',
  'lb.unsaved.discard': 'Buang perubahan',
  'lb.needsBoth.title': 'Entri memerlukan tajuk dan butiran',
  'lb.needsTitle.body': 'Berikan entri ini tajuk sebelum menyimpan.',
  'lb.needsBody.body': 'Tulis sedikit butiran sebelum menyimpan.',
  'lb.conflict.body': ({ when }) =>
    `Entri ini berubah di pelayan pada ${when}. Versi anda dan versi mereka kini berbeza.`,
  'lb.conflict.unknownTime': 'masa yang tidak diketahui',
  'lb.conflict.copyload': 'Salin punya saya & muatkan punya mereka',
  'lb.conflict.copied': 'Versi anda disalin ke papan keratan',
  'lb.gone.title': 'Entri telah dipadam di tempat lain',
  'lb.gone.body': 'Entri ini tidak lagi wujud di pelayan.',
  'lb.gone.saveNew': 'Simpan sebagai entri baharu',
  'lb.gone.discard': 'Buang',
  'lb.delete.title': 'Padam entri ini?',
  'lb.draft.title': 'Pulihkan draf belum disimpan?',
  'lb.draft.bodyNewer': ({ draft, server }) =>
    `Draf dari ${draft} ditemui, tetapi entri ini telah disimpan lebih baharu (${server}) — mungkin pada peranti lain.`,
  'lb.draft.body': ({ when, isNew }) =>
    `Draf belum disimpan dari ${when} ditemui${isNew ? ' untuk entri baharu' : ''}.`,
  'lb.draft.keepServer': 'Kekalkan versi terbaharu',
  'lb.draft.restoreAnyway': 'Tetap pulihkan draf',
  'lb.draft.restore': 'Pulihkan draf',
  'lb.draft.discard': 'Buang draf',
  'lb.banner.newer': 'Entri ini telah dikemas kini pada peranti lain.',
  'lb.banner.review': 'Semak',
  'lb.banner.keepMine': 'Kekalkan punya saya',
  'lb.import.tooLarge.title': 'Fail terlalu besar',
  'lb.import.tooLarge.body': 'Import Markdown terhad kepada 2 MB.',
  'lb.import.failed.title': 'Import gagal',
  'lb.toast.imported': ({ title }) => `“${title}” diimport`,
  'lb.toast.gone': 'Entri itu tidak lagi wujud',
  'lb.toast.offlineDraft': 'Tidak dapat menghubungi hos Bento — draf anda selamat disimpan secara tempatan',
  'lb.toast.saved': 'Entri disimpan',
  'lb.toast.deleted': 'Entri dipadam',
  'lb.toast.refreshed': 'Entri disegarkan semula daripada peranti lain',
  'lb.toast.backupPaused': 'Sandaran automatik dijeda — nota terlalu besar untuk storan pelayar',
  'lb.toast.noStorage': 'Storan pelayar tidak tersedia — simpan automatik dimatikan untuk sesi ini',
  'lb.toast.hostDown': 'Tidak dapat menghubungi hos Bento — pastikan pelayan sedang berjalan',

  /* ── metadata panel ────────────────────────────────────────── */
  'meta.title': 'Metadata',
  'meta.close': 'Tutup metadata',
  'meta.label': 'Label',
  'meta.labelPlaceholder': 'Tidak Dikategorikan',
  'meta.sublabel': 'Sub-label',
  'meta.sublabel.optional': 'pilihan',
  'meta.sublabel.needsLabel': 'perlukan label dahulu',
  'meta.tags': 'Tag',
  'meta.tagsPlaceholder': 'linux, docker, fix',
  'meta.fields': 'Medan',
  'meta.fieldNameLabel': 'Nama medan baharu',
  'meta.fieldValueLabel': 'Nilai medan baharu',
  'meta.fieldNamePlaceholder': 'nama medan',
  'meta.fieldValuePlaceholder': 'nilai medan',
  'meta.addField': 'Tambah medan',
  'meta.add': 'tambah',
  'meta.noFields': 'Belum ada medan — tambah satu di bawah (contohnya os_platform, is_valid).',
  'meta.fieldValueFor': ({ name }) => `Nilai bagi medan ${name}`,
  'meta.removeField': ({ name }) => `Buang medan ${name}`,
  'meta.remove': ({ name }) => `Buang ${name}`,
  'meta.created': 'Dicipta',
  'meta.readonly': '(baca sahaja)',
  'meta.createdEmpty': '— (ditetapkan pada simpanan pertama)',
  'meta.createdUnix': ({ ms }) => `UNIX ms: ${ms}`,
  'meta.modified': 'Diubah suai',
  'meta.urls': 'Senarai URL',
  'meta.urlsPlaceholder': 'https://…, https://…',
  'meta.urlCount': ({ n }) => `${n} pautan`,
  'meta.urlInvalid': ({ url }) => `${url}\nBukan URL http(s) yang sah — disimpan sebagai nota`,

  /* ── Prompt Library ────────────────────────────────────────── */
  'pr.searchLabel': 'Cari prompt',
  'pr.searchPlaceholder': 'Cari prompt…',
  'pr.new': 'Prompt Baharu',
  'pr.empty': 'Belum ada prompt. Simpan templat boleh guna semula anda yang pertama.',
  'pr.edit': 'Sunting prompt',
  'pr.delete': 'Padam prompt',
  'pr.why': 'Sebab ini berkesan',
  'pr.dlg.new': 'Prompt Baharu',
  'pr.dlg.edit': 'Sunting Prompt',
  'pr.dlg.close': 'Tutup editor prompt',
  'pr.f.title': 'Tajuk',
  'pr.f.category': 'Kategori',
  'pr.f.categoryPlaceholder': 'UMUM',
  'pr.f.tags': 'Tag (dipisahkan koma)',
  'pr.f.tagsPlaceholder': 'penulisan, kod',
  'pr.f.body': 'Prompt',
  'pr.f.bodyPlaceholder': 'Guna {{Nama Pemboleh Ubah}} untuk ruang letak isian.',
  'pr.f.varSample': '{{Topik}}',
  'pr.f.whyPlaceholder': 'Sebab di sebalik struktur prompt ini…',
  'pr.f.save': 'Simpan Prompt',
  'pr.err.required': 'Prompt memerlukan tajuk dan teks prompt.',
  'pr.conflict.body': 'Prompt ini telah berubah di pelayan sejak anda membukanya.',
  'pr.delete.title': 'Padam prompt ini?',
  'pr.toast.saved': 'Prompt disimpan',
  'pr.toast.updated': 'Prompt dikemas kini',
  'pr.toast.deleted': 'Prompt dipadam',
  'pr.toast.loadFailed': 'Gagal memuatkan prompt',

  /* ── Code Snippets ─────────────────────────────────────────── */
  'sn.searchLabel': 'Cari coretan',
  'sn.searchPlaceholder': 'Cari arahan, bahasa, tag…',
  'sn.new': 'Coretan Baharu',
  'sn.empty': 'Belum ada coretan. Simpan arahan boleh guna semula anda yang pertama.',
  'sn.edit': 'Sunting coretan',
  'sn.delete': 'Padam coretan',
  'sn.notes': 'Nota',
  'sn.dlg.new': 'Coretan Baharu',
  'sn.dlg.edit': 'Sunting Coretan',
  'sn.dlg.close': 'Tutup editor coretan',
  'sn.f.title': 'Tajuk',
  'sn.f.category': 'Bahasa / Alat',
  'sn.f.categoryPlaceholder': 'BASH',
  'sn.f.tags': 'Tag (dipisahkan koma)',
  'sn.f.tagsPlaceholder': 'ssh, jarak jauh',
  'sn.f.body': 'Arahan',
  'sn.f.bodyPlaceholder': 'curl -v {{Pautan URL}}',
  'sn.f.varSample': '{{Nama Fail}}',
  'sn.f.notes': 'Nota',
  'sn.f.notesPlaceholder': 'Flag, perbezaan platform, perkara yang perlu dijaga…',
  'sn.f.save': 'Simpan Coretan',
  'sn.err.required': 'Coretan memerlukan tajuk dan teks arahan.',
  'sn.conflict.body': 'Coretan ini telah berubah di pelayan sejak anda membukanya.',
  'sn.delete.title': 'Padam coretan ini?',
  'sn.toast.saved': 'Coretan disimpan',
  'sn.toast.updated': 'Coretan dikemas kini',
  'sn.toast.deleted': 'Coretan dipadam',
  'sn.toast.loadFailed': 'Gagal memuatkan coretan',

  /* ── lock screen ───────────────────────────────────────────── */
  'auth.signInSub': 'Log masuk ke ruang kerja anda',
  'auth.oneMoreStep': 'Satu langkah lagi',
  'auth.welcomeBack': ({ name }) => `Selamat kembali, ${name}`,
  'auth.signedInAs': ({ name }) => `Log masuk sebagai ${name}`,
  'auth.userId': 'ID Pengguna',
  'auth.password': 'Kata laluan',
  'auth.signIn': 'Log masuk',
  'auth.createAccountLink': 'Cipta akaun',
  'auth.createAccountSubmit': 'Cipta akaun',
  'auth.haveAccount': 'Saya sudah mempunyai akaun',
  'auth.cpIntro':
    'Pilih kata laluan baharu sebelum meneruskan. Kata laluan lalai atau tetapan semula mesti digantikan sebelum papan pemuka dibuka.',
  'auth.newPassword': 'Kata laluan baharu',
  'auth.confirmPassword': 'Sahkan kata laluan baharu',
  'auth.setPassword': 'Tetapkan kata laluan baharu',
  'auth.backToApp': 'Kembali ke aplikasi',
  'auth.newHere': 'Baharu di sini?',
  'auth.seeWhat': 'Lihat apa yang Bento OS boleh buat',
  'auth.dock.logbook': 'Tentang Buku Log Dokumen',
  'auth.dock.prompts': 'Tentang Pustaka Prompt',
  'auth.dock.snippets': 'Tentang Coretan Kod',
  'auth.err.badUsername': 'ID Pengguna: 2–32 huruf, angka, titik, sengkang atau garis bawah',
  'auth.err.shortPassword': ({ n }) => `Kata laluan memerlukan sekurang-kurangnya ${n} aksara`,
  'auth.err.defaultReuse': 'Kata laluan lalai tidak boleh diguna semula',
  'auth.err.mismatch': 'Kata laluan tidak sepadan',
  'auth.err.wrongCreds': 'ID Pengguna atau kata laluan salah',
  'auth.err.taken': 'ID Pengguna itu sudah digunakan',
  'auth.err.rateLimit': 'Terlalu banyak percubaan — tunggu sebentar dan cuba lagi',
  'auth.err.failed': 'Log masuk gagal',
  'auth.toast.pwUpdated': 'Kata laluan dikemas kini',
  'auth.delete.title': 'Padam akaun anda?',
  'auth.delete.body':
    'Ini memadam akaun anda, setiap entri LogBook dan setiap prompt secara kekal. Tiada cara membatalkannya dan tiada apa-apa disimpan (pemadaman penuh GDPR/PDPA).',
  'auth.delete.confirm': 'Padam semuanya',
  'auth.delete.failed': 'Pemadaman akaun gagal — cuba lagi kemudian',
  'auth.delete.done': 'Akaun dipadam',

  /* ── user management ───────────────────────────────────────── */
  'admin.title': 'Pengurusan pengguna',
  'admin.close': 'Tutup pengurusan pengguna',
  'admin.filterLabel': 'Tapis pengguna',
  'admin.filterPlaceholder': 'Tapis mengikut ID Pengguna…',
  'admin.newUser': '+ Pengguna baharu',
  'admin.newUserLabel': 'ID Pengguna baharu',
  'admin.newUserPlaceholder': 'ID Pengguna baharu',
  'admin.create': 'Cipta',
  'admin.footer': 'Akaun baharu bermula dengan kata laluan lalai dan mesti menukarnya semasa log masuk pertama.',
  'admin.loading': 'Memuatkan…',
  'admin.loadFailed': 'Tidak dapat memuatkan pengguna.',
  'admin.count': ({ n }) => `${n} orang`,
  'admin.noUsers': 'Belum ada pengguna.',
  'admin.role.global_admin': 'pentadbir global',
  'admin.role.admin': 'pentadbir',
  'admin.role.user': 'pengguna',
  'admin.section.global_admin': 'Pentadbir global',
  'admin.section.admin': 'Pentadbir',
  'admin.section.user': 'Pengguna',
  'admin.you': 'anda',
  'admin.youTitle': 'Anda tidak boleh menukar peranan sendiri atau memadam akaun sendiri di sini',
  'admin.resetPending': 'set semula tertunda',
  'admin.resetPendingTitle': 'Mesti tukar kata laluan pada log masuk seterusnya',
  'admin.accountCreated': 'Akaun dicipta',
  'admin.action.reset.label': 'Set semula kata laluan',
  'admin.action.reset.button': 'Set semula',
  'admin.action.reset.desc':
    'Menetapkan semula kata laluan mereka kepada lalai dan memaksa penukaran pada log masuk seterusnya.',
  'admin.action.promote.label': 'Jadikan pentadbir',
  'admin.action.promote.button': 'Naik taraf',
  'admin.action.promote.desc':
    'Membenarkan mereka mencipta pengguna dan menetapkan semula kata laluan. Mereka masih tidak boleh membaca nota orang lain.',
  'admin.action.demote.label': 'Buang status pentadbir',
  'admin.action.demote.button': 'Turun taraf',
  'admin.action.demote.desc':
    'Mengembalikan mereka kepada pengguna biasa. Entri dan prompt milik mereka sendiri tidak terjejas.',
  'admin.action.delete.label': 'Padam akaun',
  'admin.action.delete.button': 'Padam…',
  'admin.action.delete.desc':
    'Memadam akaun serta setiap entri, prompt dan coretan yang mereka miliki. Ini tidak boleh dibatalkan.',
  'admin.promoteFailed': 'Naik taraf gagal',
  'admin.demoteFailed': 'Turun taraf gagal',
  'admin.nowAdmin': ({ name }) => `${name} kini seorang pentadbir`,
  'admin.nowUser': ({ name }) => `${name} kembali menjadi pengguna biasa`,
  'admin.reset.title': ({ name }) => `Set semula kata laluan ${name}?`,
  'admin.reset.body': ({ pw }) =>
    `Kata laluan mereka kembali kepada lalai (“${pw}”) dan mereka mesti memilih kata laluan baharu pada log masuk seterusnya.`,
  'admin.reset.confirm': 'Set semula kata laluan',
  'admin.reset.failed': 'Set semula gagal — mungkin anda dihadkan kadar',
  'admin.reset.done': ({ name }) => `Kata laluan ${name} telah ditetapkan semula kepada lalai`,
  'admin.delete.title': ({ name }) => `Padam ${name}?`,
  'admin.delete.body':
    'Ini memadam akaun mereka serta setiap entri LogBook, prompt dan coretan yang mereka miliki secara kekal. Tiada cara membatalkannya.',
  'admin.delete.confirm': 'Padam semuanya',
  'admin.delete.failed': 'Pemadaman gagal — mungkin anda dihadkan kadar',
  'admin.delete.done': ({ name }) => `${name} telah dipadam`,
  'admin.create.failed': 'Penciptaan akaun gagal',
  'admin.create.done': ({ name, pw }) => `${name} dicipta — kata laluan lalai ialah “${pw}”`,

  /* ── pre-auth tour ─────────────────────────────────────────── */
  'tour.title': 'Apa yang Bento OS boleh buat',
  'tour.footer': 'Segala yang anda simpan adalah milik akaun anda sahaja — termasuk pentadbir.',
  'tour.mini.search': 'cari',
  'tour.demoCap.blanks': 'Cuba sendiri — taip pada ruang kosong yang ditonjolkan',

  'tour.lb.intro':
    'Nota panjang dalam markdown biasa — panduan, catatan kerja, dan apa-apa sahaja yang anda mahu cari semula berbulan-bulan kemudian.',
  'tour.lb.h1': 'Baca seperti halaman, sunting bila perlu',
  'tour.lb.p1':
    'Nota dibuka sebagai prosa terpapar yang kemas pada lebar bacaan yang selesa. Satu togol menukar ke editor bersebelahan.',
  'tour.lb.demoCap': 'Cuba sendiri — sunting bahagian kiri',
  'tour.lb.youWrite': 'Anda taip',
  'tour.lb.mdLabel': 'Markdown kepada pratonton',
  'tour.lb.bentoShows': 'Bento papar',
  'tour.lb.pill1': 'panduan',
  'tour.lb.pill2': 'persediaan',
  'tour.lb.h2': 'Cari semula dengan satu carian',
  'tour.lb.p2':
    'Carian merangkumi tajuk, tag, medan metadata anda sendiri, ringkasan dan kandungan sekali gus. Kumpulkan mengikut label atau tahun, atau tapis dengan pil tag.',
  'tour.lb.foot':
    'Draf disimpan automatik setiap 10 saat semasa anda menaip, jadi jika berlaku ranap atau muat semula tanpa sengaja, kerja anda ditawarkan semula.',

  'tour.pr.intro': 'Prompt yang sentiasa anda tulis semula, kini disimpan sekali dan dikumpulkan mengikut kategori.',
  'tour.pr.pill1': 'penulisan',
  'tour.pr.pill2': 'kod',
  'tour.pr.h1': 'Sebuah pustaka, bukan fail conteng-conteng',
  'tour.pr.p1':
    'Setiap prompt berada dalam kategori dengan tag tersendiri, jadi anda boleh mencari seluruh pustaka atau menapisnya kepada satu jenis kerja sahaja.',
  'tour.pr.blanksNote': 'Ruang kosong yang anda biarkan kekal sebagai ruang letak.',
  'tour.pr.h2': 'Salin teks yang siap, bukan templatnya',
  'tour.pr.p2':
    'Satu klik meletakkan prompt yang telah disusun pada papan keratan anda dengan ruang kosong telah diisi — tiada apa-apa yang perlu dikemas dengan tangan.',

  'tour.sn.intro': 'Arahan dan kod yang anda tidak mahu cari semula dua kali.',
  'tour.sn.h1': 'Dikumpulkan mengikut bahasa, diwarnakan secara automatik',
  'tour.sn.p1':
    'Apa sahaja bahasa atau alat yang anda taip menjadi kumpulannya sendiri dengan warna tersendiri — tiada palet untuk dipilih dan tiada apa-apa untuk ditetapkan.',
  'tour.sn.blanksNote': 'Ruang kosong yang sama seperti Pustaka Prompt.',
  'tour.sn.flip': 'terbalik ↻',
  'tour.sn.h2': 'Simpan sebabnya di belakang',
  'tour.sn.p2':
    'Terbalikkan kad untuk menyimpan nota bersama coretan itu — untuk apa ia digunakan, dan bahagian yang mengejutkan anda pada pukul 2 pagi.',

  // Kandungan demo. Bukan terjemahan versi Bahasa Inggeris perkataan demi
  // perkataan, tetapi ditulis sendiri dalam Bahasa Melayu — yang penting di
  // sini ialah mekanismenya, bukan kandungannya.
  'tour.sample.markdown': `## Apa-apa yang berbaloi dicari semula

Tulis dalam **markdown biasa** dan ia terus diformat semasa anda menaip.

- langkah yang benar-benar berjaya
- pautan yang anda mahu cari semula

\\\`satu baris kod\\\`
`,
  'tour.sample.prompt': 'Terangkan {{topik}} kepada {{khalayak}} dalam {{bilangan}} ayat.',
  'tour.sample.snippet': 'git checkout -b {{nama-cabang}}',

  /* ── editor ribbon ─────────────────────────────────────────── */
  'ribbon.h1': 'Tajuk 1',
  'ribbon.h2': 'Tajuk 2',
  'ribbon.h3': 'Tajuk 3',
  'ribbon.bold': 'Tebal',
  'ribbon.italic': 'Condong',
  'ribbon.strike': 'Coret',
  'ribbon.sup': 'Superskrip',
  'ribbon.sub': 'Subskrip',
  'ribbon.code': 'Kod sebaris',
  'ribbon.link': 'Pautan',
  'ribbon.ul': 'Senarai bertanda',
  'ribbon.ol': 'Senarai bernombor',
  'ribbon.checkbox': 'Item kotak semak',
  'ribbon.table': 'Sisipkan jadual 3×4',
  'ribbon.alert.note': 'Blok makluman nota',
  'ribbon.alert.tip': 'Blok makluman tip',
  'ribbon.alert.important': 'Blok makluman penting',
  'ribbon.alert.warning': 'Blok makluman amaran',
  'ribbon.alert.caution': 'Blok makluman awas',

  // Teks yang ribbon taip terus ke dalam nota, bukan bingkai di sekelilingnya
  // — jadi ia mengikut bahasa paparan sama seperti tulisan pengguna sendiri.
  'ribbon.ph.text': 'teks',
  'ribbon.ph.bold': 'tebal',
  'ribbon.ph.italic': 'condong',
  'ribbon.ph.code': 'kod',
  'ribbon.ph.linkText': 'teks pautan',
  'ribbon.ph.task': 'tugasan',
  'ribbon.table.col': ({ n }) => `Lajur ${n}`,
  'ribbon.alertBody.note': 'Maklumat berguna',
  'ribbon.alertBody.tip': 'Nasihat berguna',
  'ribbon.alertBody.important': 'Maklumat penting',
  'ribbon.alertBody.warning': 'Maklumat segera',
  'ribbon.alertBody.caution': 'Risiko atau kesan negatif',
  'ribbon.bulb.inlineLatex': 'LaTeX sebaris',
  'ribbon.bulb.blockLatex': 'LaTeX blok',
  'ribbon.bulb.mermaid': 'Carta alir Mermaid',
  'ribbon.mermaid.start': 'Mula',
  'ribbon.mermaid.decision': 'Keputusan',
  'ribbon.mermaid.done': 'Selesai',

  /* ── render pipeline ───────────────────────────────────────── */
  'alert.NOTE': 'Nota',
  'alert.TIP': 'Tip',
  'alert.IMPORTANT': 'Penting',
  'alert.WARNING': 'Amaran',
  'alert.CAUTION': 'Awas',
  'render.copyCode': 'Salin kod',
  'render.copyLangCode': ({ lang }) => `Salin kod ${lang}`,
  'render.codeCopied': 'Kod disalin',
  'render.mermaidError': 'Ralat Mermaid',

  'vars.valueFor': ({ name }) => `Nilai bagi ${name}`,

  /* ── Markdown guide ──────────────────────────────── */
  'guide.md': `
## Pemformatan

| Jenis | Sintaks |
| --- | --- |
| Tebal | \`**tebal**\` |
| Condong | \`*condong*\` |
| Coret | \`~~teks~~\` |
| Superskrip | \`x<sup>2</sup>\` → x<sup>2</sup> |
| Subskrip | \`H<sub>2</sub>O\` → H<sub>2</sub>O |
| Kod sebaris | \`\` \`kod\` \`\` |
| Pautan | \`[label](https://url)\` |
| Lompat ke tajuk | \`[label](#tajuk-ini)\` |
| Tajuk | \`# H1\` … \`### H3\` |
| Senarai bertanda | \`- item\` |
| Senarai bernombor | \`1. item\` |
| Kotak semak | \`- [ ] tugasan\` / \`- [x] selesai\` |

## Matematik (KaTeX)

Sebaris: \`$E = mc^2$\` → $E = mc^2$

Blok:

\`\`\`
$$
\\int_a^b f(x)\\,dx
$$
\`\`\`

Matematik di dalam kod sebaris atau blok kod dibiarkan seperti asal. \`$\` yang tercicir boleh berpasangan dengan \`$\` lain yang muncul kemudian dalam perenggan — gunakan pelepasan untuk harga seperti \`\\$5\`.

## Gambar rajah (Mermaid)

\`\`\`mermaid
flowchart LR
  A[Mula] --> B{Keputusan}
  B -->|Ya| C[Selesai]
\`\`\`

Ralat sintaks memaparkan cip amaran setempat; bahagian lain nota masih dipaparkan.

## Blok makluman

Mulakan petikan dengan penanda \`[!TYPE]\` pada barisnya sendiri:

> [!NOTE]
> Maklumat berguna yang pengguna perlu tahu, walaupun sekadar membaca sepintas lalu.

> [!TIP]
> Nasihat berguna untuk melakukan sesuatu dengan lebih baik atau lebih mudah.

> [!IMPORTANT]
> Maklumat penting yang pengguna perlu tahu untuk mencapai matlamat mereka.

> [!WARNING]
> Maklumat segera yang memerlukan perhatian pengguna serta-merta untuk mengelakkan masalah.

> [!CAUTION]
> Menasihatkan tentang risiko atau kesan negatif sesuatu tindakan.

## Frontmatter

Pagar \`---\` di bahagian paling atas nota — ditutup dengan \`---\` atau \`...\` — dipaparkan sebagai jadual kunci/nilai dan bukannya garis pemisah:

\`\`\`
---
title: Nota keluaran
tags: [ops, deploy]
owner:
  team: platform
  oncall: rotating
---
\`\`\`

Nilai dipaparkan sepertimana ditaip — markdown dan matematik di dalamnya kekal sebagai teks literal. Kunci dan senarai bersarang menjadi jadual tersendiri. \`---\` di mana-mana bahagian lain nota masih menjadi garis pemisah.

## Perkara yang berguna diketahui

- **Pautan** ke \`https://…\` dibuka dalam tab baharu. Pautan ke \`#tajuk-dalam-nota-ini\` pula menatal anda ke tajuk itu — tab yang sama, nota yang sama. Tulis tajuk dalam huruf kecil dengan sengkang menggantikan ruang (*Setup Steps* → \`#setup-steps\`).
- **Tag** dipisahkan koma — satu tag tidak boleh mengandungi koma.
- **Label** yang dibiarkan kosong disimpan di bawah *Tidak Dikategorikan*; sub-label memerlukan label dahulu.
- **Medan** ialah metadata nama/nilai anda sendiri (contohnya \`os_platform: macOS\`, \`is_valid: true\`). Nilai adalah teks biasa dan boleh dicari daripada bar sisi.
- **Dicipta** ditetapkan sekali sahaja dan tidak boleh diubah. **Diubah suai** dikemas kini secara automatik pada setiap simpanan, tetapi anda boleh menetapkannya secara manual — nilai yang disunting dikekalkan dan tidak ditolak ke masa semasa.
- **Import** menerima fail \`.md\` sehingga 2 MB. \`# H1\` pertama menjadi tajuk; frontmatter YAML dikekalkan dan dipaparkan sebagai jadual.
- **Simpan automatik** mengambil snapshot draf anda setiap 10 saat; anda akan ditawarkan pemulihan selepas ranap atau muat semula.
- **Pasang Bento OS** daripada menu akaun untuk menjalankannya dalam tetingkapnya sendiri. Setelah dipasang, ia masih dibuka semasa luar talian — tetapi entri anda disimpan di pelayan, jadi anda akan melihat ruang kerja dengan cip *luar talian* dan senarai kosong sehingga anda kembali dalam talian.
- Dalam prompt, isian \`{{Pemboleh Ubah}}\` dipadankan secara literal — \`{{A}}{{B}}\` ialah dua pemboleh ubah, \`{{}}\` ialah teks biasa.
`,
};
