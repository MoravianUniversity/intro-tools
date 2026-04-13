import{i as r}from"./function-planner-CWJ3MEaD.js";import"./ui-BFtFxnTg.js";import"./yjs-AbTu9oK0.js";const i={functions:[{key:1,name:"main",io:"none",code:`# Read the corpus of words from the file
words = read_words("tom-swift.txt")

print("===== New Story using Bigrams =====")
bigrams = build_bigrams(words)
bigram_story = generate_words_from_bigrams(bigrams, 100)
if len(bigram_story) != 100:
    print("ERROR: Bigram story is not 100 words long")
print(' '.join(bigram_story))

print()

print("===== New Story using Trigrams =====")
trigrams = build_trigrams(words)
trigram_story = generate_words_from_trigrams(trigrams, 100)
if len(trigram_story) != 100:
    print("ERROR: Trigam story is not 100 words long")
print(' '.join(trigram_story))`,showCode:!0,readOnly:["name","desc","params","returns","io","testable","code"]}],calls:[]};window.addEventListener("DOMContentLoaded",()=>{r("planner","bigrams",{initialModel:i,minFunctions:6,minTestable:4,adminMode:!1})});
