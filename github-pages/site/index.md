---
layout: default
title: NightWorkers | Local-first Autonomous Development Control Plane
description: NightWorkers は、ローカル環境で自律開発セッション、実行キュー、成果物、実行証跡を扱うための開発コントロールプレーンです。
permalink: /
image: /assets/img/og-image.jpg
body_class: lp-body
preload_hero: true
twitter_image_alt: NightWorkers のローカル開発コントロールプレーンを表すワークベンチのキービジュアル
og_image_alt: NightWorkers のローカル開発コントロールプレーンを表すワークベンチのキービジュアル
---

<main class="lp">
  <section class="hero">
    <picture class="hero-bg" aria-hidden="true">
      <source srcset="{{ '/assets/img/nightworkers-hero.webp' | relative_url }}" type="image/webp">
      <img
        src="{{ '/assets/img/nightworkers-hero.png' | relative_url }}"
        alt=""
        width="1672"
        height="941"
        loading="eager"
        decoding="async"
        fetchpriority="high"
      >
    </picture>
    <div class="hero-shade" aria-hidden="true"></div>

    <div class="shell hero-shell">
      <header class="topbar">
        <a class="brand" href="{{ '/' | relative_url }}">
          <img src="{{ '/assets/img/favicon.svg' | relative_url }}" alt="" width="32" height="32">
          <span>NightWorkers</span>
        </a>
        <div class="chip">local-first / queue / evidence</div>
      </header>

      <div class="hero-copy">
        <p class="eyebrow">Autonomous Development Control Plane</p>
        <h1>
          自律開発を、<br>
          ローカルで<br>
          運用する。
        </h1>
        <p class="lead">
          NightWorkers は、Project Folder ごとの Workbench Session、明示的な Implementation Queue、
          supervisor-worker 実行、artifact review、run event ledger を束ねる
          ローカルファーストな開発コントロールプレーンです。
        </p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="https://github.com/ugnoguchigxp/nightWorkers">GitHubで見る</a>
          <a class="btn btn-secondary" href="https://github.com/ugnoguchigxp/nightWorkers/blob/main/README.md">READMEを読む</a>
        </div>
      </div>

      <div class="status-strip" aria-label="NightWorkers capability highlights">
        <div><strong>Project Workbench</strong><span>chat, planning, artifacts, review</span></div>
        <div><strong>Implementation Queue</strong><span>explicit admission, processor lanes</span></div>
        <div><strong>Evidence Ledger</strong><span>events, diffs, todos, reports</span></div>
      </div>
    </div>
  </section>

  <section class="section intro">
    <div class="shell section-grid">
      <div>
        <p class="section-kicker">Why NightWorkers</p>
        <h2>チャットの外側に、実行状態を残す。</h2>
      </div>
      <p class="section-lead">
        長い自律開発では、会話ログだけでは運用できません。どの Project で、どの Session が動き、
        何が Queue に入り、どの run が何を変更し、どんな証跡を残したかを追える必要があります。
        NightWorkers はその制御面をローカルな Workbench に置きます。
      </p>
    </div>
  </section>

  <section class="section">
    <div class="shell">
      <div class="section-heading">
        <p class="section-kicker">Current Surfaces</p>
        <h2>Project、Session、Queue、Run を別々の状態として扱う。</h2>
      </div>
      <div class="cards">
        <article class="card">
          <span class="card-icon icon-spec" aria-hidden="true"></span>
          <h3>Project Workbench</h3>
          <p>Project Folder ごとに Session を持ち、チャット、計画、実行、artifact review、timeline inspection を一つの場所で扱います。</p>
        </article>
        <article class="card">
          <span class="card-icon icon-queue" aria-hidden="true"></span>
          <h3>Implementation Queue</h3>
          <p>通常の Session chat と自動化を分け、承認済みの実装作業だけを Processor lanes に流します。</p>
        </article>
        <article class="card">
          <span class="card-icon icon-ledger" aria-hidden="true"></span>
          <h3>Run Evidence</h3>
          <p>run events、todo、tool outcome、diff、test result、final report を SQLite に残し、再接続後も追えるようにします。</p>
        </article>
        <article class="card">
          <span class="card-icon icon-blueprint" aria-hidden="true"></span>
          <h3>Artifacts</h3>
          <p>Diff、App Blueprint、Blueprint Preview、Data Model、Spec などを Session の判断材料として表示します。</p>
        </article>
        <article class="card">
          <span class="card-icon icon-settings" aria-hidden="true"></span>
          <h3>Runtime Settings</h3>
          <p>LLM providers、MCP servers、Agent Hooks、Todo Workflow gates、appearance をローカル設定として管理します。</p>
        </article>
        <article class="card">
          <span class="card-icon icon-desktop" aria-hidden="true"></span>
          <h3>Desktop Runtime</h3>
          <p>Tauri shell が frontend と Node sidecar を起動し、runtime state と logs をローカルに保持します。</p>
        </article>
      </div>
    </div>
  </section>

  <section class="section section-spec">
    <div class="shell spec-grid">
      <div class="section-heading">
        <p class="section-kicker">Operating Model</p>
        <h2>実行は runner 任せにせず、ローカルな状態遷移として扱う。</h2>
        <p class="section-copy">
          NightWorkers は、会話、キュー投入、実行、証跡、成果物、設定を一つの永続状態に寄せます。
          Workbench で話した内容と、Queue で走った automation と、run が残した evidence を混ぜずに追えます。
        </p>
      </div>
      <div class="spec-stack" aria-label="NightWorkers operating model">
        <div class="spec-node active"><span class="icon-dot"></span><strong>Project + Session</strong><em>repo root と会話の作業単位</em></div>
        <div class="spec-node active"><span class="icon-dot"></span><strong>Queue Admission</strong><em>承認済み automation の入口</em></div>
        <div class="spec-node active"><span class="icon-dot"></span><strong>Worker Run</strong><em>tool calls、todo、verification</em></div>
        <div class="spec-node output"><span class="icon-dot"></span><strong>Evidence + Artifacts</strong><em>diff、reports、Blueprint、Spec、Data Model</em></div>
      </div>
    </div>
  </section>

  <section class="section section-flow">
    <div class="shell">
      <div class="section-heading">
        <p class="section-kicker">Execution Loop</p>
        <h2>依頼からレビューまでを、証跡つきで追う。</h2>
      </div>
      <div class="flow">
        <article class="flow-step"><span>01</span><p>Project Folder を登録</p></article>
        <article class="flow-step"><span>02</span><p>Workbench Session で相談・計画・直接依頼</p></article>
        <article class="flow-step"><span>03</span><p>必要な作業を Queue に明示投入</p></article>
        <article class="flow-step"><span>04</span><p>supervisor-worker run を実行</p></article>
        <article class="flow-step"><span>05</span><p>artifact、diff、test、final report を確認</p></article>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="shell">
      <div class="section-heading">
        <p class="section-kicker">Boundary</p>
        <h2>NightWorkers は、チャット UI でも万能 runner でもない。</h2>
      </div>
      <div class="compare">
        <article class="compare-box">
          <h3>Available now</h3>
          <ul>
            <li>Project Folder と Workbench Session の永続管理</li>
            <li>Implementation Queue、Processor lanes、Todo gates</li>
            <li>Run timeline、artifact pane、provider / MCP / hooks settings</li>
          </ul>
        </article>
        <article class="compare-box active">
          <h3>Current limits</h3>
          <ul>
            <li>PR 作成、merge、deploy は自動化しない</li>
            <li>並列 multi-agent orchestration ではない</li>
            <li>外部 memory service や hosted demo を前提にしない</li>
          </ul>
        </article>
      </div>
    </div>
  </section>

  <section class="section section-roadmap">
    <div class="shell">
      <div class="section-heading">
        <p class="section-kicker">Next Concept</p>
        <h2>大きな目的を、評価できる作業構造へ分解する。</h2>
      </div>
      <div class="pills" aria-label="Future design view concepts">
        <span>mission pilot</span>
        <span>task graph</span>
        <span>work packages</span>
        <span>review findings</span>
        <span>proposed goals</span>
        <span>proposal adoption</span>
      </div>
      <p class="roadmap-note">
        まだ実装済みの主機能としては扱いません。今後は、広いゴールを Mission、Objective、
        Work Package、Task、Verification Gate に分解し、review evidence から次の候補作業へつなぐ方向を検討しています。
      </p>
    </div>
  </section>

  <section class="cta">
    <div class="shell">
      <div class="cta-panel">
        <p class="section-kicker">Local-first by design</p>
        <h2>自律開発を、運用できる単位に戻す。</h2>
        <p>
          NightWorkers は、Project、Session、Queue、Run、Artifact、Settings をローカルで扱う control plane です。
        </p>
        <a class="btn btn-primary" href="https://github.com/ugnoguchigxp/nightWorkers">GitHub プロジェクトを見る</a>
      </div>
    </div>
  </section>
</main>

<footer class="footer">
  <div class="shell">NightWorkers LP · GitHub Pages + Jekyll</div>
</footer>
