// 日本語 — Japanese.
//
// Written to be read, not decoded: this is a translation of what each phrase
// *does*, not of its English word order. A few conventions hold throughout,
// and they are the reason the file reads the way it does.
//
//   · Buttons and labels are noun phrases (体言止め) — 「保存」, not
//     「保存する」. Sentences addressed to the user are です・ます調.
//   · English leans on the em dash to bolt a clause on; Japanese does not.
//     Those become two sentences, or a 。 and a fresh clause.
//   · Quoted titles take 「」, never “”, and short confirmations drop the
//     trailing 。 the way Japanese notifications normally do.
//   · Counters replace plurals. Japanese has no -s, so the phrases that need
//     one in English are simply written once here.
//
// Anything that is a proper noun (Bento OS), a code identifier, or an example
// command stays as it is — translating `curl` would be worse than useless.

export default {
  /* ── アプリの外枠 ──────────────────────────────────────────── */
  'app.title': 'Bento OS',

  'nav.tools': 'ツール',
  'nav.tab.logbook': 'ドキュメント記録帳',
  'nav.tab.logbook.short': '記録帳',
  'nav.tab.prompts': 'プロンプトライブラリ',
  'nav.tab.prompts.short': 'プロンプト',
  'nav.tab.snippets': 'コードスニペット',
  'nav.tab.snippets.short': 'スニペット',
  'nav.minimize': '現在のツールをドックにしまう',
  'nav.focus': '集中モードの切り替え',
  'nav.fullscreen': '全画面表示の切り替え',
  'nav.unsaved': '未保存の変更があります',
  'nav.offline': 'オフライン',
  'nav.hostUnreachable': 'ホストに接続できません',
  'nav.accountMenu': 'アカウントメニュー',
  'nav.account': 'アカウント',
  'nav.dock': '最小化したツール',

  'menu.admin': 'ユーザー管理',
  'menu.changepw': 'パスワードを変更',
  'menu.install': 'Bento OS をインストール…',
  'menu.delete': 'アカウントを削除…',
  'menu.signout': 'サインアウト',

  'theme.toggle': 'ライト／ダークテーマの切り替え',
  'lang.toggle': '表示言語を変更',
  'lang.label': '言語',

  'main.focusOn': '集中モード オン',
  'main.focusOff': '集中モード オフ',
  'main.noFullscreen': 'この環境では全画面表示を利用できません',
  'main.updated': 'Bento OS を更新しました。再読み込みします',
  'main.restore': ({ name }) => `${name}を元に戻す`,
  'main.minimized': ({ name }) => `${name}をドックにしまいました`,
  'main.restored': ({ name }) => `${name}を元に戻しました`,

  'pwa.installed': 'Bento OS をインストールしました。これからは独立したウィンドウで開きます',
  'pwa.updateReady': '更新の準備ができました。次に Bento OS を開いたときに適用されます',

  'ui.dismissNotice': 'お知らせを閉じる',

  'clip.title': '手動でコピー',
  'clip.body':
    'この環境ではクリップボードを利用できません（HTTPS が必要です。たとえば tailscale serve の URL）。下のテキストを選択してコピーしてください。',

  /* ── 共通の語彙 ────────────────────────────────────────────── */
  'common.cancel': 'キャンセル',
  'common.delete': '削除',
  'common.save': '保存',
  'common.gotIt': 'わかりました',
  'common.copy': 'コピー',
  'common.copied': '✓ コピーしました',
  'common.close': '閉じる',
  'common.back': '戻る',
  'common.done': '完了',
  'common.all': 'すべて',
  'common.clearFilters': '絞り込みを解除',
  'common.commaSeparated': '（カンマ区切り）',
  'common.markdownSupported': '・Markdown が使えます',
  'common.reloadTheirs': 'サーバー側を読み込む',
  'common.overwriteTheirs': 'サーバー側を上書き',
  'common.filterByTag': 'タグで絞り込む',
  'common.willBeDeleted': ({ title }) => `「${title}」を完全に削除します。`,
  'common.noMatchQuery': ({ q }) => `「${q}」に一致するものはありません。`,
  'common.noMatchTags': '選択したタグに一致するものはありません。',
  'common.placeholderHint': 'ハイライトされた箇所をクリックすると入力できます。',
  // 語順が英語と逆になるので、例示を括弧に入れて前後を入れ替えている。
  'common.varsHintPre': '二重波かっこの変数（例：',
  'common.varsHintPost': '）は、カード上でそのまま書き換えられる入力欄になります。',
  'common.savedElsewhere': '別の端末で保存されています',

  'time.now': 'たった今',
  'time.minutes': ({ n }) => `${n}分前`,
  'time.hours': ({ n }) => `${n}時間前`,
  'time.days': ({ n }) => `${n}日前`,

  /* ── ドキュメント記録帳 ────────────────────────────────────── */
  'lb.new': '新規エントリー',
  'lb.import': 'インポート',
  'lb.importTitle': 'Markdown ファイルから読み込む',
  'lb.searchLabel': 'エントリーを検索',
  'lb.searchPlaceholder': 'タイトル・タグ・本文を検索…',
  'lb.groupBy': 'エントリーのグループ化',
  'lb.group.flat': 'なし',
  'lb.group.label': 'ラベル',
  'lb.group.year': '年',
  'lb.savedEntries': '保存済みのエントリー',
  'lb.guide': 'Markdown ガイド',
  'lb.guideClose': 'ガイドを閉じる',
  'lb.openList': 'エントリー一覧を開く',
  'lb.hideSidebar': 'サイドバーを隠す',
  'lb.showSidebar': 'サイドバーを表示',
  'lb.titleLabel': 'エントリーのタイトル',
  'lb.titlePlaceholder': '無題のエントリー',
  'lb.edited': '編集済み',
  'lb.hideMeta': 'メタデータを隠す',
  'lb.showMeta': 'メタデータを表示',
  'lb.readMode.title': '閲覧モード（クリックで編集）',
  'lb.readMode.aria': '閲覧モード（編集モードに切り替え）',
  'lb.editMode.title': '編集モード（クリックで閲覧）',
  'lb.editMode.aria': '編集モード（閲覧モードに切り替え）',
  'lb.save': '保存',
  'lb.saving': '保存中…',
  'lb.savedFlash': '✓ 保存しました',
  'lb.close': 'エントリーを閉じる',
  'lb.summary': '概要・課題',
  'lb.summaryLabel': '概要または課題',
  'lb.summaryPlaceholder': 'このエントリーはどんな問題を解決しますか？',
  'lb.body': '本文',
  'lb.bodyHint': '（知識・解決策・トラブルシューティング・回避策など）',
  'lb.formatting': '書式',
  'lb.bulb': '記法リファレンス：LaTeX と Mermaid のひな形',
  'lb.bulbMenu': '記法のひな形を挿入',
  'lb.viewToggle': 'エディターかプレビュー',
  'lb.write': '編集',
  'lb.preview': 'プレビュー',
  'lb.editorLabel': 'Markdown の詳細と解決策',
  'lb.editorPlaceholder':
    'Markdown でメモを書きましょう…\n\n$インライン数式$、$$ブロック数式$$、```mermaid の図が使えます。',
  'lb.resize': 'エディターとプレビューの幅を調整',
  'lb.previewLabel': 'レンダリング結果',
  'lb.empty': '開いているエントリーはありません。一覧から選ぶか、新しく作成してください。',
  'lb.previewFailed': 'プレビューを表示できませんでした。',
  'lb.delete': 'エントリーを削除',
  'lb.drawer': 'エントリー',

  'lb.noMatch': ({ q }) => `「${q}」に一致するエントリーはありません。`,
  'lb.noEntries': 'まだエントリーがありません。最初の 1 件を作成しましょう。',
  'lb.clearSearch': '検索を解除',
  'lb.noTagMatch': () => '選択したタグに一致するエントリーはありません。',
  'lb.clearTagFilter': 'タグの絞り込みを解除',

  'lb.unsaved.title': '未保存の変更があります',
  'lb.unsaved.body': 'このエントリーには保存されていない変更があります。',
  'lb.unsaved.discard': '変更を破棄',
  'lb.needsBoth.title': 'タイトルと本文が必要です',
  'lb.needsTitle.body': '保存する前にタイトルを入力してください。',
  'lb.needsBody.body': '保存する前に本文を入力してください。',
  'lb.conflict.body': ({ when }) =>
    `このエントリーはサーバー側で変更されています（${when}）。お使いの内容とサーバー側の内容が食い違っています。`,
  'lb.conflict.unknownTime': '時刻不明',
  'lb.conflict.copyload': '自分の内容をコピーしてサーバー側を読み込む',
  'lb.conflict.copied': '自分の内容をクリップボードにコピーしました',
  'lb.gone.title': 'エントリーは別の端末で削除されました',
  'lb.gone.body': 'このエントリーはサーバー上に存在しません。',
  'lb.gone.saveNew': '新しいエントリーとして保存',
  'lb.gone.discard': '破棄',
  'lb.delete.title': 'このエントリーを削除しますか？',
  'lb.draft.title': '未保存の下書きを復元しますか？',
  'lb.draft.bodyNewer': ({ draft, server }) =>
    `${draft} に保存された下書きが見つかりましたが、このエントリーはその後 ${server} に保存されています。別の端末で保存された可能性があります。`,
  'lb.draft.body': ({ when, isNew }) =>
    `${when} に保存された未保存の下書きが見つかりました${isNew ? '（新規エントリーの下書きです）' : ''}。`,
  'lb.draft.keepServer': '新しい方を残す',
  'lb.draft.restoreAnyway': 'それでも下書きを復元',
  'lb.draft.restore': '下書きを復元',
  'lb.draft.discard': '下書きを破棄',
  'lb.banner.newer': 'このエントリーは別の端末で更新されました。',
  'lb.banner.review': '確認する',
  'lb.banner.keepMine': '自分の内容を残す',
  'lb.import.tooLarge.title': 'ファイルが大きすぎます',
  'lb.import.tooLarge.body': 'Markdown の読み込みは 2 MB までです。',
  'lb.import.failed.title': '読み込みに失敗しました',
  'lb.toast.imported': ({ title }) => `「${title}」を読み込みました`,
  'lb.toast.gone': 'そのエントリーは存在しません',
  'lb.toast.offlineDraft': 'Bento ホストに接続できません。下書きはこの端末に残っています',
  'lb.toast.saved': 'エントリーを保存しました',
  'lb.toast.deleted': 'エントリーを削除しました',
  'lb.toast.refreshed': '別の端末の変更を読み込みました',
  'lb.toast.backupPaused': '自動バックアップを停止しました。ブラウザーの保存容量に対してノートが大きすぎます',
  'lb.toast.noStorage': 'ブラウザーの保存領域を利用できません。このセッションでは自動保存が無効です',
  'lb.toast.hostDown': 'Bento ホストに接続できません。サーバーが動いているか確認してください',

  /* ── メタデータパネル ──────────────────────────────────────── */
  'meta.title': 'メタデータ',
  'meta.close': 'メタデータを閉じる',
  'meta.label': 'ラベル',
  'meta.labelPlaceholder': '未分類',
  'meta.sublabel': 'サブラベル',
  'meta.sublabel.optional': '任意',
  'meta.sublabel.needsLabel': '先にラベルが必要です',
  'meta.tags': 'タグ',
  'meta.tagsPlaceholder': 'linux, docker, fix',
  'meta.fields': 'フィールド',
  'meta.fieldNameLabel': '新しいフィールド名',
  'meta.fieldValueLabel': '新しいフィールドの値',
  'meta.fieldNamePlaceholder': 'フィールド名',
  'meta.fieldValuePlaceholder': '値',
  'meta.addField': 'フィールドを追加',
  'meta.add': '追加',
  'meta.noFields': 'フィールドはまだありません。下から追加できます（例：os_platform、is_valid）。',
  'meta.fieldValueFor': ({ name }) => `フィールド ${name} の値`,
  'meta.removeField': ({ name }) => `フィールド ${name} を削除`,
  'meta.remove': ({ name }) => `${name} を削除`,
  'meta.created': '作成日時',
  'meta.readonly': '（変更不可）',
  'meta.createdEmpty': '—（最初の保存時に記録されます）',
  'meta.createdUnix': ({ ms }) => `UNIX ミリ秒：${ms}`,
  'meta.modified': '更新日時',
  'meta.urls': 'URL 一覧',
  'meta.urlsPlaceholder': 'https://…, https://…',
  'meta.urlCount': ({ n }) => `${n} 件のリンク`,
  'meta.urlInvalid': ({ url }) => `${url}\n有効な http(s) URL ではないため、メモとして扱います`,

  /* ── プロンプトライブラリ ──────────────────────────────────── */
  'pr.searchLabel': 'プロンプトを検索',
  'pr.searchPlaceholder': 'プロンプトを検索…',
  'pr.new': '新規プロンプト',
  'pr.empty': 'まだプロンプトがありません。繰り返し使えるテンプレートを保存してみましょう。',
  'pr.edit': 'プロンプトを編集',
  'pr.delete': 'プロンプトを削除',
  'pr.why': 'なぜ効くのか',
  'pr.dlg.new': '新規プロンプト',
  'pr.dlg.edit': 'プロンプトを編集',
  'pr.dlg.close': 'プロンプトエディターを閉じる',
  'pr.f.title': 'タイトル',
  'pr.f.category': 'カテゴリー',
  'pr.f.categoryPlaceholder': '一般',
  'pr.f.tags': 'タグ（カンマ区切り）',
  'pr.f.tagsPlaceholder': '文章, コード',
  'pr.f.body': 'プロンプト',
  'pr.f.bodyPlaceholder': '{{変数名}} と書くと、あとから埋められる入力欄になります。',
  'pr.f.varSample': '{{トピック}}',
  'pr.f.whyPlaceholder': 'この組み立てにした理由…',
  'pr.f.save': 'プロンプトを保存',
  'pr.err.required': 'プロンプトにはタイトルと本文の両方が必要です。',
  'pr.conflict.body': '開いてから、サーバー側でこのプロンプトが変更されました。',
  'pr.delete.title': 'このプロンプトを削除しますか？',
  'pr.toast.saved': 'プロンプトを保存しました',
  'pr.toast.updated': 'プロンプトを更新しました',
  'pr.toast.deleted': 'プロンプトを削除しました',
  'pr.toast.loadFailed': 'プロンプトを読み込めませんでした',

  /* ── コードスニペット ──────────────────────────────────────── */
  'sn.searchLabel': 'スニペットを検索',
  'sn.searchPlaceholder': 'コマンド・言語・タグを検索…',
  'sn.new': '新規スニペット',
  'sn.empty': 'まだスニペットがありません。繰り返し使えるコマンドを保存してみましょう。',
  'sn.edit': 'スニペットを編集',
  'sn.delete': 'スニペットを削除',
  'sn.notes': 'メモ',
  'sn.dlg.new': '新規スニペット',
  'sn.dlg.edit': 'スニペットを編集',
  'sn.dlg.close': 'スニペットエディターを閉じる',
  'sn.f.title': 'タイトル',
  'sn.f.category': '言語・ツール',
  'sn.f.categoryPlaceholder': 'BASH',
  'sn.f.tags': 'タグ（カンマ区切り）',
  'sn.f.tagsPlaceholder': 'ssh, remote',
  'sn.f.body': 'コマンド',
  'sn.f.bodyPlaceholder': 'curl -v {{URL}}',
  'sn.f.varSample': '{{ファイル名}}',
  'sn.f.notes': 'メモ',
  'sn.f.notesPlaceholder': 'オプション、環境ごとの違い、つまずきやすい点…',
  'sn.f.save': 'スニペットを保存',
  'sn.err.required': 'スニペットにはタイトルとコマンドの両方が必要です。',
  'sn.conflict.body': '開いてから、サーバー側でこのスニペットが変更されました。',
  'sn.delete.title': 'このスニペットを削除しますか？',
  'sn.toast.saved': 'スニペットを保存しました',
  'sn.toast.updated': 'スニペットを更新しました',
  'sn.toast.deleted': 'スニペットを削除しました',
  'sn.toast.loadFailed': 'スニペットを読み込めませんでした',

  /* ── ロック画面 ────────────────────────────────────────────── */
  'auth.signInSub': 'ワークスペースにサインイン',
  'auth.oneMoreStep': 'あと一歩です',
  'auth.welcomeBack': ({ name }) => `おかえりなさい、${name} さん`,
  'auth.signedInAs': ({ name }) => `${name} としてサインインしました`,
  'auth.userId': 'ユーザー ID',
  'auth.password': 'パスワード',
  'auth.signIn': 'サインイン',
  'auth.createAccountLink': 'アカウントを作成する',
  'auth.createAccountSubmit': 'アカウントを作成',
  'auth.haveAccount': 'すでにアカウントをお持ちの方',
  'auth.cpIntro':
    '続ける前に新しいパスワードを設定してください。初期パスワードやリセットされたパスワードのままでは、ダッシュボードを開けません。',
  'auth.newPassword': '新しいパスワード',
  'auth.confirmPassword': '新しいパスワード（確認）',
  'auth.setPassword': 'パスワードを設定',
  'auth.backToApp': 'アプリに戻る',
  'auth.newHere': 'はじめての方は',
  'auth.seeWhat': 'Bento OS でできること',
  'auth.dock.logbook': 'ドキュメント記録帳について',
  'auth.dock.prompts': 'プロンプトライブラリについて',
  'auth.dock.snippets': 'コードスニペットについて',
  'auth.err.badUsername': 'ユーザー ID：英数字・ドット・ハイフン・アンダースコアで 2〜32 文字',
  'auth.err.shortPassword': ({ n }) => `パスワードは ${n} 文字以上にしてください`,
  'auth.err.defaultReuse': '初期パスワードは再利用できません',
  'auth.err.mismatch': 'パスワードが一致しません',
  'auth.err.wrongCreds': 'ユーザー ID またはパスワードが違います',
  'auth.err.taken': 'そのユーザー ID はすでに使われています',
  'auth.err.rateLimit': '試行回数が多すぎます。しばらく待ってからもう一度お試しください',
  'auth.err.failed': 'サインインに失敗しました',
  'auth.toast.pwUpdated': 'パスワードを変更しました',
  'auth.delete.title': 'アカウントを削除しますか？',
  'auth.delete.body':
    'アカウントと、記録帳のすべてのエントリー、すべてのプロンプトを完全に消去します。取り消しはできず、データは一切残りません（GDPR／PDPA に基づく完全削除）。',
  'auth.delete.confirm': 'すべて削除',
  'auth.delete.failed': 'アカウントを削除できませんでした。時間をおいてお試しください',
  'auth.delete.done': 'アカウントを削除しました',

  /* ── ユーザー管理 ──────────────────────────────────────────── */
  'admin.title': 'ユーザー管理',
  'admin.close': 'ユーザー管理を閉じる',
  'admin.filterLabel': 'ユーザーを絞り込む',
  'admin.filterPlaceholder': 'ユーザー ID で絞り込む…',
  'admin.newUser': '＋ ユーザーを追加',
  'admin.newUserLabel': '新しいユーザー ID',
  'admin.newUserPlaceholder': '新しいユーザー ID',
  'admin.create': '作成',
  'admin.footer': '新しいアカウントは初期パスワードで始まり、初回サインイン時に変更が必要です。',
  'admin.loading': '読み込み中…',
  'admin.loadFailed': 'ユーザーを読み込めませんでした。',
  'admin.count': ({ n }) => `${n} 人`,
  'admin.noUsers': 'ユーザーがまだいません。',
  'admin.role.global_admin': '全体管理者',
  'admin.role.admin': '管理者',
  'admin.role.user': '一般',
  'admin.section.global_admin': '全体管理者',
  'admin.section.admin': '管理者',
  'admin.section.user': 'ユーザー',
  'admin.you': '自分',
  'admin.youTitle': 'ここでは自分の権限を変更したり、自分のアカウントを削除したりはできません',
  'admin.resetPending': '変更待ち',
  'admin.resetPendingTitle': '次回サインイン時にパスワードの変更が必要です',
  'admin.accountCreated': 'アカウント作成日',
  'admin.action.reset.label': 'パスワードをリセット',
  'admin.action.reset.button': 'リセット',
  'admin.action.reset.desc': 'パスワードを初期値に戻し、次回サインイン時に変更を求めます。',
  'admin.action.promote.label': '管理者にする',
  'admin.action.promote.button': '権限付与',
  'admin.action.promote.desc':
    'ユーザーの作成とパスワードのリセットができるようになります。他の人のノートは引き続き読めません。',
  'admin.action.demote.label': '管理者から外す',
  'admin.action.demote.button': '権限解除',
  'admin.action.demote.desc': '一般ユーザーに戻します。本人のエントリーやプロンプトはそのまま残ります。',
  'admin.action.delete.label': 'アカウントを削除',
  'admin.action.delete.button': '削除…',
  'admin.action.delete.desc':
    'アカウントと、本人が所有するすべてのエントリー・プロンプト・スニペットを消去します。取り消しはできません。',
  'admin.promoteFailed': '権限の付与に失敗しました',
  'admin.demoteFailed': '権限の解除に失敗しました',
  'admin.nowAdmin': ({ name }) => `${name} を管理者にしました`,
  'admin.nowUser': ({ name }) => `${name} を一般ユーザーに戻しました`,
  'admin.reset.title': ({ name }) => `${name} のパスワードをリセットしますか？`,
  'admin.reset.body': ({ pw }) =>
    `パスワードが初期値（「${pw}」）に戻り、次回ログイン時に新しいパスワードの設定が必要になります。`,
  'admin.reset.confirm': 'リセットする',
  'admin.reset.failed': 'リセットに失敗しました。回数制限に達している可能性があります',
  'admin.reset.done': ({ name }) => `${name} のパスワードを初期値に戻しました`,
  'admin.delete.title': ({ name }) => `${name} を削除しますか？`,
  'admin.delete.body':
    'このアカウントと、本人が所有する記録帳のエントリー・プロンプト・スニペットをすべて完全に消去します。取り消しはできません。',
  'admin.delete.confirm': 'すべて削除',
  'admin.delete.failed': '削除に失敗しました。回数制限に達している可能性があります',
  'admin.delete.done': ({ name }) => `${name} を削除しました`,
  'admin.create.failed': 'アカウントの作成に失敗しました',
  'admin.create.done': ({ name, pw }) => `${name} を作成しました。初期パスワードは「${pw}」です`,

  /* ── サインイン前のツアー ──────────────────────────────────── */
  'tour.title': 'Bento OS でできること',
  'tour.footer': '保存したものはすべて自分のアカウントだけのものです。管理者にも見えません。',
  'tour.mini.search': '検索',
  'tour.demoCap.blanks': '試してみましょう：ハイライトされた箇所に入力できます',

  'tour.lb.intro':
    'ガイド、作業のまとめ、数か月後にまた探したくなるもの。長めのメモを、そのままの Markdown で残せます。',
  'tour.lb.h1': 'ふだんは読みもの、必要なときだけ編集',
  'tour.lb.p1':
    'メモは読みやすい幅の整った文章として開きます。切り替えはボタンひとつ、左右に並んだエディターになります。',
  'tour.lb.demoCap': '試してみましょう：左側を書き換えてみてください',
  'tour.lb.youWrite': '入力',
  'tour.lb.mdLabel': 'プレビューする Markdown',
  'tour.lb.bentoShows': '表示',
  'tour.lb.pill1': 'ガイド',
  'tour.lb.pill2': 'セットアップ',
  'tour.lb.h2': 'ひと検索でまた見つかる',
  'tour.lb.p2':
    'タイトル、タグ、自分で決めたメタデータ、概要、本文をまとめて検索します。ラベルや年でまとめたり、タグで絞り込んだりもできます。',
  'tour.lb.foot':
    '入力中は 10 秒ごとに下書きが自動保存されます。もしクラッシュしても、うっかり再読み込みしても、書きかけを戻せます。',

  'tour.pr.intro': '何度も書き直しているプロンプトを、一度保存してカテゴリーごとにまとめておけます。',
  'tour.pr.pill1': '文章',
  'tour.pr.pill2': 'コード',
  'tour.pr.h1': '使い捨てのメモではなく、ライブラリとして',
  'tour.pr.p1':
    'プロンプトはそれぞれカテゴリーとタグを持ちます。全体をまとめて検索することも、目的の種類だけに絞り込むこともできます。',
  'tour.pr.blanksNote': '空のままにした箇所は、そのまま入力欄として残ります。',
  'tour.pr.h2': 'テンプレートではなく、仕上がった文をコピー',
  'tour.pr.p2':
    'クリックひとつで、空欄を埋めた状態のプロンプトがクリップボードに入ります。あとから手直しする手間はありません。',

  'tour.sn.intro': '二度と調べ直したくないコマンドやコードを、ここに。',
  'tour.sn.h1': '言語ごとにまとまり、色も自動で',
  'tour.sn.p1':
    '入力した言語やツールがそのままグループになり、それぞれ別の色がつきます。パレットを選ぶ必要も、設定するものもありません。',
  'tour.sn.blanksNote': 'プロンプトライブラリと同じ入力欄です。',
  'tour.sn.flip': '裏返す ↻',
  'tour.sn.h2': '理由はカードの裏に',
  'tour.sn.p2':
    'カードを裏返すと、スニペットと一緒にメモを残せます。何のためのものか、そして深夜に足をすくわれるのはどこか。',

  // デモ用の文面。英語版を訳したものではなく、日本語で書き下ろしている
  // ——ここで見せたいのは仕組みであって、題材ではないため。
  'tour.sample.markdown': `## あとで探したくなること

**そのままの Markdown** で書けば、打った先から整形されます。

- 実際にうまくいった手順
- また開きたくなるリンク

\\\`一行のコード\\\`
`,
  'tour.sample.prompt': '{{トピック}}について、{{相手}}に{{文の数}}文で説明してください。',
  'tour.sample.snippet': 'git checkout -b {{ブランチ名}}',

  /* ── エディターのツールリボン ──────────────────────────────── */
  'ribbon.h1': '見出し 1',
  'ribbon.h2': '見出し 2',
  'ribbon.h3': '見出し 3',
  'ribbon.bold': '太字',
  'ribbon.italic': '斜体',
  'ribbon.strike': '取り消し線',
  'ribbon.sup': '上付き文字',
  'ribbon.sub': '下付き文字',
  'ribbon.code': 'インラインコード',
  'ribbon.link': 'リンク',
  'ribbon.ul': '箇条書き',
  'ribbon.ol': '番号付きリスト',
  'ribbon.checkbox': 'チェックボックス',
  'ribbon.table': '3×4 の表を挿入',
  'ribbon.alert.note': 'メモの囲み',
  'ribbon.alert.tip': 'ヒントの囲み',
  'ribbon.alert.important': '重要の囲み',
  'ribbon.alert.warning': '警告の囲み',
  'ribbon.alert.caution': '注意の囲み',

  // ここから下はノートの中に打ち込まれる文字なので、ユーザー自身が
  // 書くのと同じ言語で入る。
  'ribbon.ph.text': 'テキスト',
  'ribbon.ph.bold': '太字',
  'ribbon.ph.italic': '斜体',
  'ribbon.ph.code': 'コード',
  'ribbon.ph.linkText': 'リンクテキスト',
  'ribbon.ph.task': 'タスク',
  'ribbon.table.col': ({ n }) => `列 ${n}`,
  'ribbon.alertBody.note': '知っておくと役に立つ情報',
  'ribbon.alertBody.tip': 'うまく進めるためのヒント',
  'ribbon.alertBody.important': '目的を達成するために必要な情報',
  'ribbon.alertBody.warning': 'すぐに確認が必要な情報',
  'ribbon.alertBody.caution': 'リスクや望ましくない結果',
  'ribbon.bulb.inlineLatex': 'インライン LaTeX',
  'ribbon.bulb.blockLatex': 'ブロック LaTeX',
  'ribbon.bulb.mermaid': 'Mermaid フローチャート',
  'ribbon.mermaid.start': '開始',
  'ribbon.mermaid.decision': '判断',
  'ribbon.mermaid.done': '完了',

  /* ── 描画パイプライン ──────────────────────────────────────── */
  'alert.NOTE': 'メモ',
  'alert.TIP': 'ヒント',
  'alert.IMPORTANT': '重要',
  'alert.WARNING': '警告',
  'alert.CAUTION': '注意',
  'render.copyCode': 'コードをコピー',
  'render.copyLangCode': ({ lang }) => `${lang} のコードをコピー`,
  'render.codeCopied': 'コードをコピーしました',
  'render.mermaidError': 'Mermaid の記法エラー',

  'vars.valueFor': ({ name }) => `${name} の値`,

  /* ── Markdown ガイド ──────────────────────────────────────── */
  'guide.md': `
## 書式

| 種類 | 記法 |
| --- | --- |
| 太字 | \`**太字**\` |
| 斜体 | \`*斜体*\` |
| 取り消し線 | \`~~テキスト~~\` |
| 上付き文字 | \`x<sup>2</sup>\` → x<sup>2</sup> |
| 下付き文字 | \`H<sub>2</sub>O\` → H<sub>2</sub>O |
| インラインコード | \`\` \`コード\` \`\` |
| リンク | \`[ラベル](https://url)\` |
| 見出しへ飛ぶ | \`[ラベル](#見出しのタイトル)\` |
| 見出し | \`# 見出し1\` 〜 \`### 見出し3\` |
| 箇条書き | \`- 項目\` |
| 番号付きリスト | \`1. 項目\` |
| チェックボックス | \`- [ ] タスク\` / \`- [x] 完了\` |

## 数式（KaTeX）

インライン: \`$E = mc^2$\` → $E = mc^2$

ブロック:

\`\`\`
$$
\\int_a^b f(x)\\,dx
$$
\`\`\`

コードスパンやコードフェンスの中の数式は、そのままの文字として残ります。段落の中の \`$\` は、離れた場所にあるもう一つの \`$\` と対になってしまうことがあります。金額を書くときは \`\\$5\` のようにエスケープしてください。

## 図（Mermaid）

\`\`\`mermaid
flowchart LR
  A[開始] --> B{判断}
  B -->|はい| C[完了]
\`\`\`

記法に誤りがあるとその場に警告のチップが出ますが、ノートの残りの部分はそのまま表示されます。

## 囲み記事

引用の先頭行に \`[!TYPE]\` のマーカーを単独で置きます:

> [!NOTE]
> ざっと読んでいる人にも知っておいてほしい情報。

> [!TIP]
> もっとうまく、もっと簡単に進めるための助言。

> [!IMPORTANT]
> 目的を達成するために欠かせない情報。

> [!WARNING]
> 問題を避けるために、すぐ目を向けてほしい情報。

> [!CAUTION]
> その操作に伴うリスクや、望ましくない結果について。

## フロントマター

ノートのいちばん先頭に置いた \`---\` のフェンスを \`---\` または \`...\` で閉じると、水平線ではなくキーと値の表として表示されます:

\`\`\`
---
title: リリースノート
tags: [ops, deploy]
owner:
  team: platform
  oncall: rotating
---
\`\`\`

値は打ったとおりに表示されます。中に書いた Markdown や数式も、そのままの文字として残ります。入れ子になったキーやリストは、それぞれ独立した表になります。ノートの途中にある \`---\` は、これまでどおり水平線です。

## 知っておくと便利なこと

- **リンク** のうち \`https://…\` は新しいタブで開きます。\`#このノートの見出し\` へのリンクは、同じタブ・同じノートのまま、その見出しまでスクロールします。見出しに空白がなければ、見出しの文字をそのまま書けば届きます（英語の見出しは小文字にして、空白をハイフンに置き換えてください。*Setup Steps* → \`#setup-steps\`）。
- **タグ** はカンマ区切りです。タグ自体にカンマは使えません。
- **ラベル** を空のままにすると *未分類* に入ります。サブラベルを使うには、先にラベルが必要です。
- **フィールド** は自分で決める名前と値のメタデータです（例: \`os_platform: macOS\`、\`is_valid: true\`）。値はプレーンテキストで、サイドバーから検索できます。
- **作成日時** は一度だけ記録され、あとから変えられません。**更新日時** は保存のたびに自動で更新されますが、手で設定することもできます。手で入れた値は現在時刻に上書きされず、そのまま残ります。
- **インポート** できるのは 2 MB までの \`.md\` ファイルです。最初の \`# H1\` がタイトルになり、YAML フロントマターはそのまま保持されて表として表示されます。
- **自動保存** は 10 秒ごとに下書きのスナップショットを取ります。クラッシュや再読み込みのあとに、復元するかどうかを尋ねます。
- **Bento OS のインストール** はアカウントメニューから。独立したウィンドウで動くようになります。インストール後はオフラインでも起動しますが、エントリーはサーバー上にあるため、オンラインに戻るまでは *オフライン* のチップが出て一覧は空のままです。
- プロンプトの \`{{変数}}\` は文字どおりに対応します。\`{{A}}{{B}}\` は変数が二つ、\`{{}}\` はただの文字列です。
`,
};
