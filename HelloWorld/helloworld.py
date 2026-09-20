import time

sentence = "hello world! "

print("\033[H\033[J", end="")
time.sleep(1/12)


def theRenderer(way):

    sentenceDict = {"capsScroll": lambda sentence, number: (sentence[number:] + sentence[:number].upper()),
                    "minimizeScroll": lambda sentence, number: (sentence[number:].upper()+sentence[:number]),
                    "caps": lambda sentence, number: (sentence[:number].upper()+sentence[number:]),
                    "minimize": lambda sentence, number: (sentence[:number]+sentence[number:].upper())}


    anotherVariable = sentenceDict.get(way)

    for number in range(len(sentence)):
        print("\033[H\033[J", end="")


        print(anotherVariable(sentence,number))
        time.sleep(1/12)

print(sentence.capitalize())
time.sleep(1/2)
theRenderer("capsScroll")
theRenderer("minimizeScroll")
theRenderer("caps")
theRenderer("minimize")

print("\033[H\033[J", end="")
print(sentence.capitalize())