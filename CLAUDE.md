# BoxBim — regras do projeto

## Toda atualização vira um commit
- Cada pedido concluído (funcionalidade, correção, documentação) termina com **um commit** neste repositório,
  depois de testado. Não acumular várias atualizações num commit só.
- Mensagem em português: primeira linha `BoxBim X.Y.Z: resumo curto`; corpo com o que mudou e por quê, se ajudar.
- Antes do commit: `npm run build` sem erros, versão nova no `package.json`, entrada no `CHANGELOG.md`
  (Keep a Changelog, versionamento semântico) e o README atualizado quando a mudança é visível ao usuário.
- Não fazer push nem criar branches/PRs sem o usuário pedir.

## Como testar
- Servidor de teste isolado (nunca o do usuário): `BOXBIM_DATA=<pasta temporária> PORTA=3911 node server/index.js`.
- A instância do BoxBim do próprio usuário (porta 3000, `Documentos\\BoxBim`) não deve ser fechada nem alterada.
- Não modificar o Revit sem confirmação; não mudar a política de segurança do npm; nunca usar senhas reais.

## Implantação
- Docker / Easypanel: ver `DEPLOY.md`.
