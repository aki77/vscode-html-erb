import * as vscode from 'vscode';
import { commands, CompletionList, DocumentFilter, Hover, languages, LinkedEditingRanges, Range, Uri, workspace, WorkspaceEdit } from 'vscode';
import { getLanguageService, LanguageService, TokenType } from 'vscode-html-languageservice';

function isInsideRubyRegion(
  languageService: LanguageService,
  documentText: string,
  offset: number
) {
  const scanner = languageService.createScanner(documentText);

  let token = scanner.scan();
  while (token !== TokenType.EOS) {
    if (token === TokenType.Unknown && offset >= scanner.getTokenOffset() && offset <= scanner.getTokenEnd()) {
      const text = scanner.getTokenText();
      return text.startsWith('%') && text.endsWith('%');
    }

    token = scanner.scan();
  }

  return false;
}

type EmbeddedRegion = {
	start: number;
	end: number;
};

function getRubyVirtualContent(
  languageService: LanguageService,
  documentText: string
): string {
  const regions: EmbeddedRegion[] = [];
  const scanner = languageService.createScanner(documentText);

  let token = scanner.scan();
  while (token !== TokenType.EOS) {
    if (token === TokenType.Unknown) {
      const text = scanner.getTokenText();
      if (text.startsWith('%') && text.endsWith('%')) {
        const start = text.startsWith('%=') ? 2 : 1;
        regions.push({
          start: scanner.getTokenOffset() + start,
          end: scanner.getTokenEnd() - 1,
        });
      }
    }

    token = scanner.scan();
  }

  let content = documentText
    .split('\n')
    .map(line => {
      return ' '.repeat(line.length);
    }).join('\n');

  regions.forEach(r => {
    content = content.slice(0, r.start) + documentText.slice(r.start, r.end) + content.slice(r.end);
  });

  return content;
}

export function activate(context: vscode.ExtensionContext) {
  const htmlLanguageService = getLanguageService();
  const virtualDocumentContents = new Map<string, string>();
  const documentSelector: DocumentFilter = {
    scheme: 'file',
    language: 'erb',
    pattern: '**/*.html.erb',
  };

  context.subscriptions.push(
    workspace.registerTextDocumentContentProvider('embedded-content', {
      provideTextDocumentContent: (uri) => {
        const originalUri = uri.path.slice(1).slice(0, uri.path.lastIndexOf('.') - 1);
        console.log('originalUri', originalUri);
        const decodedUri = decodeURIComponent(originalUri);
        return virtualDocumentContents.get(decodedUri);
      }
    })
  );

  languages.registerHoverProvider(documentSelector, {
    async provideHover(document, position) {
      const documentText = document.getText();
      const isRuby = isInsideRubyRegion(htmlLanguageService, documentText, document.offsetAt(position));
      const content = isRuby ? getRubyVirtualContent(htmlLanguageService, documentText) : documentText;
      const ext = isRuby ? 'rb' : 'html';

      const originalUri = document.uri.toString(true);
      virtualDocumentContents.set(originalUri, content);

      const vdocUriString = `embedded-content://html/${encodeURIComponent(
        originalUri
      )}.${ext}`;
      const vdocUri = Uri.parse(vdocUriString);

      const results =  await commands.executeCommand<Hover[]>(
        'vscode.executeHoverProvider',
        vdocUri,
        position,
      );
      return results[0];
    }
  });

  languages.registerCompletionItemProvider(documentSelector, {
    async provideCompletionItems(document, position, _token, context) {
      const documentText = document.getText();
      const isRuby = isInsideRubyRegion(htmlLanguageService, documentText, document.offsetAt(position));
      const content = isRuby ? getRubyVirtualContent(htmlLanguageService, documentText) : documentText;
      const ext = isRuby ? 'rb' : 'html';

      const originalUri = document.uri.toString(true);
      virtualDocumentContents.set(originalUri, content);

      const vdocUriString = `embedded-content://html/${encodeURIComponent(
        originalUri
      )}.${ext}`;
      const vdocUri = Uri.parse(vdocUriString);

      return  await commands.executeCommand<CompletionList>(
        'vscode.executeCompletionItemProvider',
        vdocUri,
        position,
        context.triggerCharacter,
      );
    }
  });

  languages.registerLinkedEditingRangeProvider(documentSelector, {
    async provideLinkedEditingRanges(document, position, _token) {
      const documentText = document.getText();
      const isRuby = isInsideRubyRegion(htmlLanguageService, documentText, document.offsetAt(position));
      if (isRuby) {
        return;
      }

      const htmlDocument = htmlLanguageService.parseHTMLDocument({ ...document, uri: document.uri.toString() });
      const ranges = htmlLanguageService.findLinkedEditingRanges({ ...document, uri: document.uri.toString() }, position, htmlDocument);
      if (!ranges) {
        return;
      }

      return new LinkedEditingRanges(ranges.map(r => new Range(r.start.line, r.start.character, r.end.line, r.end.character)));
    },
  });
}

// this method is called when your extension is deactivated
export function deactivate() {}
